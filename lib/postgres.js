'use strict';

/**
 * Module dependencies
 */
const pg = require('pg');
const jdb = require('jugglingdb');
const util = require('util');

exports.initialize = function initializeSchema(schema, callback) {
    if (!pg) return;
    let settings = {};
    if (schema.settings.url) {
        // compatibility with 0.0.4, connect using connection strings:
        // postgres://username:password@host:port/database
        settings = schema.settings.url;
    } else {
        'password host port database poolSize ssl'.split(' ').forEach(function(k) {
            settings[k] = schema.settings[k];
        });

        settings.user = schema.settings.username;
    }

    schema.adapter = new PG();
    schema.adapter.schema = schema;
    schema.adapter.settings = settings;
    // TODO: It is a dirty fix. Currently no way to dissconnect all the clients.
    schema.adapter.client = { end() {} };

    callback();
};

function PG() {
    this.name = 'postgres';
    this._models = {};
}

require('util').inherits(PG, jdb.BaseSQL);

PG.prototype.define = function(descr) {
    // copy single-column indexes to settings.indexes
    if (!descr.settings) descr.settings = {};
    Object.keys(descr.properties).forEach(function(key) {
        const property = descr.properties[key];
        if (property.index || property.unique) {
            if (!descr.settings.indexes) descr.settings.indexes = {};
            let idxname = descr.model.modelName + '_' + key + '_idx';
            const idx = { keys: [key] };
            if (property.unique) {
                idxname = descr.model.modelName + '_' + key + '_key';
                idx.kind = 'UNIQUE';
            }
            if (!descr.settings.indexes[idxname])
                descr.settings.indexes[idxname] = idx;
        }
    });
    this._models[descr.model.modelName] = descr;
};

PG.prototype.query = function(sql, callback) {
    const time = Date.now();
    const log = this.log;
    pg.connect(this.settings, function(err, client, done) {
        if (err) {
            return callback(err);
        }
        client.query(sql, function(err, data) {
            if (log) log(sql, time);
            // harish2704: when we call done, client is return back to pool
            // so that it can be reused again. It's necessary for working with pools
            done();
            callback(err, data ? data.rows : null);
        });
    });
};

PG.prototype.count = function count(model, callback, filter) {
    this.query('SELECT count(id) as cnt  FROM ' + this.tableEscaped(model) + ' ' + this.toFilter(model, filter && { where: filter }), function(err, data) {
        if (err) return callback(err);
        let count = null;

        if (data && data[0]) {
            count = parseInt(data[0].cnt);
            if (isNaN(count)) {
                err = new Error('count: query did not return an integer');
                count = null;
            }
        }
        else {
            err = new Error('count: query returned no data');
        }

        callback(err, count);
    }.bind(this));
};
/**
 * Must invoke callback(err, id)
 */
PG.prototype.create = function(model, data, callback) {
    const fields = this.toFields(model, data, true);
    let sql = 'INSERT INTO ' + this.tableEscaped(model) + '';
    if (fields) {
        sql += ' ' + fields;
    } else {
        sql += ' VALUES ()';
    }
    sql += ' RETURNING id';
    this.query(sql, function(err, info) {
        if (err) return callback(err);
        callback(err, info && info[0] && info[0].id);
    });
};

PG.prototype.updateOrCreate = function(model, data, callback) {
    const pg = this;
    const fieldsNames = [];
    const fieldValues = [];
    const combined = [];
    const props = this._models[model].properties;
    Object.keys(data).forEach(function(key) {
        if (props[key] || key === 'id') {
            const k = '"' + key + '"';
            let v;
            if (key !== 'id') {
                v = pg.toDatabase(props[key], data[key]);
            } else {
                v = data[key];
            }
            fieldsNames.push(k);
            fieldValues.push(v);
            if (key !== 'id') combined.push(k + ' = ' + v);
        }
    });

    let sql = 'UPDATE ' + this.tableEscaped(model);
    sql += ' SET ' + combined + ' WHERE id = ' + data.id + ';';
    sql += ' INSERT INTO ' + this.tableEscaped(model);
    sql += ' (' + fieldsNames.join(', ') + ')';
    sql += ' SELECT ' + fieldValues.join(', ');
    sql += ' WHERE NOT EXISTS (SELECT 1 FROM ' + this.tableEscaped(model);
    sql += ' WHERE id = ' + data.id + ') RETURNING id';

    this.query(sql, function(err, info) {
        if (!err && info && info[0] && info[0].id) {
            data.id = info[0].id;
        }
        callback(err, data);
    });
};

PG.prototype.toFields = function(model, data, forCreate) {
    const fields = [];
    const props = this._models[model].properties;

    if (forCreate) {
        const columns = [];
        Object.keys(data).forEach(function(key) {
            if (props[key]) {
                if (key === 'id') return;
                columns.push('"' + key + '"');
                fields.push(this.toDatabase(props[key], data[key]));
            }
        }.bind(this));
        return '(' + columns.join(',') + ') VALUES (' + fields.join(',') + ')';
    } else {
        Object.keys(data).forEach(function(key) {
            if (props[key]) {
                fields.push('"' + key + '" = ' + this.toDatabase(props[key], data[key]));
            }
        }.bind(this));
        return fields.join(',');
    }
};

PG.prototype.toDatabase = function(prop, val) {
    if (val === null || val === undefined) {
        // Postgres complains with NULLs in not null columns
        // If we have an autoincrement value, return DEFAULT instead
        if (prop.autoIncrement) {
            return 'DEFAULT';
        }
        else {
            return 'NULL';
        }
    }
    if (prop && prop.type.name === 'JSON') {
        return escape(JSON.stringify(val));
    }
    if (prop && prop.type instanceof Array) {
        return escape(JSON.stringify(val));
    }
    if (val && val.constructor.name === 'Object') {
        const operator = Object.keys(val)[0];
        val = val[operator];
        if (operator === 'between') {
            return this.toDatabase(prop, val[0]) + ' AND ' + this.toDatabase(prop, val[1]);
        }
        if (operator === 'inq' || operator === 'nin') {
            val = val.slice(0);
            for (let i = 0; i < val.length; i++) {
                val[i] = escape(val[i]);
            }
            return val.join(',');
        }
    }
    if (prop.type.name === 'Number') {
        if (!val && val !== 0) {
            if (prop.autoIncrement) {
                return 'DEFAULT';
            }
            else {
                return 'NULL';
            }
        }
        return val;
    }

    if (prop.type.name === 'Date') {
        if (!val) {
            if (prop.autoIncrement) {
                return 'DEFAULT';
            }
            else {
                return 'NULL';
            }
        }
        if (!val.toISOString) {
            val = new Date(val);
        }
        const iso = escape(val.toISOString()).substring(1);
        return 'TIMESTAMP WITH TIME ZONE ' + iso;
    }

    if (val === null || val === undefined) {
        val = 'NULL';
    }

    return escape(val.toString());
};

PG.prototype.fromDatabase = function(model, data) {
    if (!data) return null;
    const props = this._models[model].properties;
    Object.keys(data).forEach(function(key) {
        const val = data[key];
        data[key] = val;
    });
    return data;
};

PG.prototype.escapeName = function(name) {
    return '"' + name.replace(/\./g, '"."') + '"';
};

PG.prototype.getColumns = function(model) {
    return '"' + Object.keys(this._models[model].properties).join('", "') + '"';
};


PG.prototype.all = function all(model, filter, callback) {
    this.query('SELECT ' + this.getColumns(model) +  '  FROM ' + this.tableEscaped(model) + ' ' + this.toFilter(model, filter), function(err, data) {
        if (err) {
            return callback(err, []);
        }
        if (filter && filter.include) {
            this._models[model].model.include(data, filter.include, callback);
        } else {
            callback(null, data);
        }
    }.bind(this));
};

PG.prototype.processWhere = function(model, conds) {
    const props = this._models[model].properties;
    const fields = [];

    if (typeof conds === 'string') {
        fields.push(conds);
    } else if (util.isArray(conds)) {
        const query = conds.shift().replace(/\?/g, function(s) {
            return escape(conds.shift());
        });
        fields.push(query);
    } else {
        Object.keys(conds).forEach(function(key) {
            if (conds[key] && conds[key].constructor.name === 'RegExp') {
                const regex = conds[key];
                var sqlCond = '"' + key + '"';

                if (regex.ignoreCase) {
                    sqlCond += ' ~* ';
                } else {
                    sqlCond += ' ~ ';
                }

                sqlCond += '\'' + regex.source + '\'';

                fields.push(sqlCond);

                return;
            }
            if (props[key]) {
                const filterValue = this.toDatabase(props[key], conds[key]);
                if (conds[key] && conds[key].constructor.name === 'Object') {
                    const condType = Object.keys(conds[key])[0];
                    var sqlCond = '"' + key + '"';
                    if ((condType == 'inq' || condType == 'nin') && filterValue.length == 0) {
                        fields.push(condType == 'inq' ? 'FALSE' : 'TRUE');
                        return true;
                    }
                    switch (condType) {
                        case 'gt':
                            sqlCond += ' > ';
                            break;
                        case 'gte':
                            sqlCond += ' >= ';
                            break;
                        case 'lt':
                            sqlCond += ' < ';
                            break;
                        case 'lte':
                            sqlCond += ' <= ';
                            break;
                        case 'between':
                            sqlCond += ' BETWEEN ';
                            break;
                        case 'inq':
                            sqlCond += ' IN ';
                            break;
                        case 'nin':
                            sqlCond += ' NOT IN ';
                            break;
                        case 'neq':
                            if (filterValue === 'NULL') {
                                sqlCond += ' IS NOT ';
                            } else {
                                sqlCond += ' != ';
                            }
                            break;
                        case 'like':
                            sqlCond += ' LIKE ';
                            break;
                        case 'nlike':
                            sqlCond += ' NOT LIKE ';
                            break;
                        default:
                            sqlCond += ' ' + condType + ' ';
                            break;
                    }
                    sqlCond += (condType == 'inq' || condType == 'nin') ? '(' + filterValue + ')' : filterValue;
                    fields.push(sqlCond);
                } else {
                    if (filterValue === 'NULL') {
                        fields.push('"' + key + '" IS ' + filterValue);
                    } else {
                        fields.push('"' + key + '" = ' + filterValue);
                    }
                }
            }
            else if (key === 'or' && util.isArray(conds[key])) {
                const ors = [];

                conds[key].forEach(function(and) {
                    and = this.processWhere(model, and);
                    if (and.length) {
                        ors.push('(' + and.join(' AND ') + ')');
                    }
                }.bind(this));

                if (ors.length) {
                    fields.push('(' + ors.join(' OR ') + ')');
                }
            }
            else if (key === 'arbitrary') {
                fields.push(conds[key]);
            }

        }.bind(this));
    }

    return fields;
};

PG.prototype.toFilter = function(model, filter) {
    if (filter && typeof filter.where === 'function') {
        return filter();
    }
    if (!filter) return '';
    let out = '';

    if (filter.where) {
        const fields = this.processWhere(model, filter.where);
        if (fields.length) {
            out += ' WHERE ' + fields.join(' AND ');
        }
    }

    if (filter.order) {
        const t = filter.order.split(/\s+/);
        filter.order = [];
        t.forEach(function(token) {
            if (token.match(/^ASC$|^DESC$/i)) {
                filter.order[filter.order.length - 1] += ' ' + token;
            } else {
                filter.order.push('"' + token + '"');
            }
        });
        out += ' ORDER BY ' + filter.order.join(',');
    }

    if (filter.limit) {
        out += ' LIMIT ' + filter.limit + ' OFFSET ' + (filter.offset || '0');
    }

    return out;
};

function getTableStatus(model, cb) {
    function decoratedCallback(err, data) {
        data.forEach(function(field) {
            field.Type = mapPostgresDatatypes(field.Type);
        });
        cb(err, data);
    }
    this.query('SELECT column_name as "Field", udt_name as "Type", is_nullable as "Null", column_default as "Default" FROM information_schema.COLUMNS WHERE table_name = \'' + this.table(model) + '\'', decoratedCallback);
}

function getIndexStatus(model, cb) {
    function decoratedCallback(err, data) {
        if (data === null) data = [];
        data.forEach(function(index) {
            index.Columns = index.Columns.split(',');
        });
        cb(err, data);
    }
    this.query('SELECT c.relname AS "Name",b.indisunique AS "Unique",ARRAY_TO_STRING(ARRAY_AGG(d.attname ORDER BY b.columnpos_order), \',\') AS "Columns"' +
             '  FROM' +
             '    (SELECT indrelid,indexrelid,indisunique,indkey[columnpos_order] AS columnpos,columnpos_order' +
             '      FROM' +
             '        (SELECT indrelid,indexrelid,indisunique,indkey,GENERATE_SUBSCRIPTS(indkey, 1) AS columnpos_order' +
             '          FROM pg_index' +
             '          WHERE indrelid=\'' + this.tableEscaped(model) + '\'::regclass' +
             '            AND indisprimary=false) a) b' +
             '    INNER JOIN pg_class c' +
             '      ON b.indexrelid = c.oid' +
             '    INNER JOIN pg_attribute d' +
             '      ON b.indrelid = d.attrelid' +
             '        AND b.columnpos = d.attnum' +
             '  GROUP BY "Name","Unique"', decoratedCallback);
}

PG.prototype.autoupdate = function(cb) {
    const self = this;
    let wait = 0;
    Object.keys(this._models).forEach(function(model) {
        wait += 1;
        let fields;
        getTableStatus.call(self, model, function(err, fields) {
            if (!err && fields.length) {
                self.alterTable(model, fields, function(err) {
                    if (err) {
                        console.log(err);
                    }

                    getIndexStatus.call(self, model, function(err, indexes) {
                        self.alterTableIndexes(model, indexes, done);
                    });
                });
            } else {
                self.createTable(model, function(err) {
                    if (err) {
                        console.log(err);
                    }

                    // we just created the table, so there will be no indexes
                    const sql = getIndexesToAdd.call(self, model, []);
                    applySqlIndexChanges.call(self, model, sql, done);
                });
            }
        });
    });

    let hadError;
    function done(err) {
        if (err) {
            hadError = err;
            console.log(err);
        }
        if (--wait === 0 && cb) {
            cb(hadError);
        }
    }
};

PG.prototype.isActual = function(cb) {
    const self = this;
    let wait = 0;
    let actual = true;
    Object.keys(this._models).forEach(function(model) {
        wait += 1;
        getTableStatus.call(self, model, function(err, fields) {
            // short circuit if we know we need to create the table
            if (!err && fields.length) {
                // short circuit index checks if there are property changes
                const propertyChanges = getPendingChanges.call(self, model, fields);
                if (propertyChanges.length) {
                    actual = false;
                    done(err);
                } else {
                    getIndexStatus.call(self, model, function(err, indexes) {
                        const indexChanges = getPendingIndexChanges.call(self, model, indexes);
                        if (indexChanges.length) {
                            actual = false;
                        }
                        done(err);
                    });
                }
            } else {
                actual = false;
                done(err);
            }
        });
    });

    let hadError;
    function done(err) {
        if (err) {
            hadError = err;
            console.log(err);
        }
        if (--wait === 0 && cb) {
            cb(hadError, actual);
        }
    }
};

PG.prototype.alterTable = function(model, actualFields, done) {
    const self = this;
    const pendingChanges = getPendingChanges.call(self, model, actualFields);
    applySqlChanges.call(self, model, pendingChanges, done);
};

PG.prototype.alterTableIndexes = function(model, actualIndexes, done) {
    const self = this;
    const pendingChanges = getPendingIndexChanges.call(self, model, actualIndexes);
    applySqlIndexChanges.call(self, model, pendingChanges, done);
};

function getPendingChanges(model, actualFields) {
    let sql = [];
    const self = this;
    sql = sql.concat(getColumnsToAdd.call(self, model, actualFields));
    sql = sql.concat(getPropertiesToModify.call(self, model, actualFields));
    sql = sql.concat(getColumnsToDrop.call(self, model, actualFields));
    return sql;
}

function getPendingIndexChanges(model, actualIndexes) {
    let sql = [];
    const self = this;
    sql = sql.concat(getIndexesToAdd.call(self, model, actualIndexes));
    sql = sql.concat(getIndexesToModify.call(self, model, actualIndexes));
    sql = sql.concat(getIndexesToDrop.call(self, model, actualIndexes));
    return sql;
}

function getColumnsToAdd(model, actualFields) {
    const self = this;
    const m = self._models[model];
    const propNames = Object.keys(m.properties);
    const sql = [];
    propNames.forEach(function(propName) {
        if (propName === 'id') return;
        const found = searchForPropertyInActual.call(self, propName, actualFields);
        if (!found && propertyHasNotBeenDeleted.call(self, model, propName)) {
            sql.push(addPropertyToActual.call(self, model, propName));
        }
    });
    return sql;
}

function getIndexesToAdd(model, actualIndexes) {
    const self = this;
    const m = self._models[model];
    const indexNames = m.settings.indexes && Object.keys(m.settings.indexes);
    const sql = [];
    if (indexNames) {
        indexNames.forEach(function(indexName) {
            const found = searchForIndexInActual.call(self, indexName, actualIndexes);
            if (!found && indexHasNotBeenDeleted.call(self, model, indexName)) {
                sql.push(addIndexToActual.call(self, model, indexName));
            }
        });
    }
    return sql;
}

function addPropertyToActual(model, propName) {
    const self = this;
    const p = self._models[model].properties[propName];
    const sqlCommand = 'ADD COLUMN "' + propName + '" ' + self.propertySettingsSQL(model, propName);
    return sqlCommand;
}

function addIndexToActual(model, indexName) {
    // we use a "constraint" for unique indexes
    const self = this;
    const i = self._models[model].settings.indexes[indexName];
    const kind = i.kind || '';
    const type = i.type ? ' USING ' + i.type : '';
    const columns = i.keys ? '"' + i.keys.join('","') + '"' : i.columns;
    let sqlCommand = null;
    if (kind.toLowerCase() === 'unique' && (type === '' || i.type.toLowerCase() === 'btree')) {
        sqlCommand = 'ALTER TABLE ' + self.tableEscaped(model) + ' ADD CONSTRAINT "' + indexName + '" UNIQUE (' + columns + ')';
    } else {
        sqlCommand = 'CREATE ' + kind + ' INDEX "' + indexName + '" ON ' + self.tableEscaped(model) + type + ' (' + columns + ')';
    }
    return sqlCommand;
}

function searchForPropertyInActual(propName, actualFields) {
    let found = false;
    actualFields.forEach(function(f) {
        if (f.Field === propName) {
            found = f;
            return;
        }
    });
    return found;
}

function searchForIndexInActual(indexName, actualIndexes) {
    let found = false;
    actualIndexes.forEach(function(i) {
        if (i.Name === indexName) {
            found = i;
            return;
        }
    });
    return found;
}

function getPropertiesToModify(model, actualFields) {
    const self = this;
    const sql = [];
    const m = self._models[model];
    const propNames = Object.keys(m.properties);
    let found;
    propNames.forEach(function(propName) {
        if (propName === 'id') return;
        found = searchForPropertyInActual.call(self, propName, actualFields);
        if (found && propertyHasNotBeenDeleted.call(self, model, propName)) {
            if (datatypeChanged(propName, found)) {
                sql.push(modifyDatatypeInActual.call(self, model, propName));
            }
            if (nullabilityChanged(propName, found)) {
                sql.push(modifyNullabilityInActual.call(self, model, propName));
            }
        }
    });

    return sql;

    function datatypeChanged(propName, oldSettings) {
        const newSettings = m.properties[propName];
        if (!newSettings) return false;
        return oldSettings.Type.toLowerCase() !== datatype(newSettings);
    }

    function nullabilityChanged(propName, oldSettings) {
        const newSettings = m.properties[propName];
        if (!newSettings) return false;
        let changed = false;
        if (oldSettings.Null === 'YES' && (newSettings.allowNull === false || newSettings.null === false)) changed = true;
        if (oldSettings.Null === 'NO' && !(newSettings.allowNull === false || newSettings.null === false)) changed = true;
        return changed;
    }
}

function getIndexesToModify(model, actualIndexes) {
    const self = this;
    let sql = [];
    const m = self._models[model];
    const indexNames = m.settings.indexes && Object.keys(m.settings.indexes);
    let found;
    if (indexNames) {
        indexNames.forEach(function(indexName) {
            found = searchForIndexInActual.call(self, indexName, actualIndexes);
            if (found && indexHasNotBeenDeleted.call(self, model, indexName)) {
                const i = m.settings.indexes[indexName];
                const columns = i.keys ? i.keys : i.columns.split(',');
                const shouldBeUnique = !!(i.kind && i.kind.toLowerCase() === 'unique');
                if (found.Columns.length !== columns.length || found.Unique !== shouldBeUnique || columnOrderChanged(columns, found.Columns)) {
                    sql = sql.concat(modifyIndexInActual.call(self, model, indexName, found.Unique));
                }
            }
        });
    }
    return sql;

    function columnOrderChanged(oldColumns, actualColumns) {
        for (let i = 0; i < oldColumns.length; i++) {
            if (oldColumns[i].trim() !== actualColumns[i].trim()) {
                return true;
            }
        }
        return false;
    }
}

function modifyDatatypeInActual(model, propName) {
    const self = this;
    const sqlCommand = 'ALTER COLUMN "' + propName + '"  TYPE ' + datatype(self._models[model].properties[propName]);
    return sqlCommand;
}

function modifyNullabilityInActual(model, propName) {
    const self = this;
    let sqlCommand = 'ALTER COLUMN "' + propName + '" ';
    if (propertyCanBeNull.call(self, model, propName)) {
        sqlCommand = sqlCommand + 'DROP ';
    } else {
        sqlCommand = sqlCommand + 'SET ';
    }
    sqlCommand = sqlCommand + 'NOT NULL';
    return sqlCommand;
}

function modifyIndexInActual(model, indexName, actuallyUnique) {
    const self = this;
    const sql = [];
    sql.push(dropIndexFromActual.call(self, model, indexName, actuallyUnique));
    sql.push(addIndexToActual.call(self, model, indexName));
    return sql;
}

function getColumnsToDrop(model, actualFields) {
    const self = this;
    const sql = [];
    actualFields.forEach(function(actualField) {
        if (actualField.Field === 'id') return;
        if (actualFieldNotPresentInModel(actualField, model)) {
            sql.push('DROP COLUMN "' + actualField.Field + '"');
        }
    });
    return sql;

    function actualFieldNotPresentInModel(actualField, model) {
        return !(self._models[model].properties[actualField.Field]);
    }
}

function getIndexesToDrop(model, actualIndexes) {
    const self = this;
    const sql = [];
    const m = self._models[model];
    actualIndexes.forEach(function(actualIndex) {
        if (actualIndexNotPresentInModel(actualIndex.Name, model)) {
            sql.push(dropIndexFromActual.call(self, model, actualIndex.Name, actualIndex.Unique));
        }
    });
    return sql;

    function actualIndexNotPresentInModel(actualIndex, model) {
        return !m.settings.indexes || !m.settings.indexes[actualIndex];
    }
}

function dropIndexFromActual(model, indexName, unique) {
    const self = this;
    if (unique)
        return 'ALTER TABLE ' + self.tableEscaped(model) + ' DROP CONSTRAINT "' + indexName + '"';
    return 'DROP INDEX "' + indexName + '"';
}

function applySqlChanges(model, pendingChanges, done) {
    const self = this;
    if (pendingChanges.length) {
        let thisQuery = 'ALTER TABLE ' + self.tableEscaped(model);
        let ranOnce = false;
        pendingChanges.forEach(function(change) {
            if (ranOnce) thisQuery = thisQuery + ',';
            thisQuery = thisQuery + ' ' + change;
            ranOnce = true;
        });
        thisQuery = thisQuery + ';';
        self.query(thisQuery, callback);
    } else {
        done();
    }

    function callback(err, data) {
        if (err) console.log(err);
        done();
    }
}

function applySqlIndexChanges(model, pendingChanges, done, idx) {
    const self = this;
    idx |= 0;
    if (idx < pendingChanges.length) {
        self.query(pendingChanges[idx] + ';', function(err) {
            if (err) console.log(err);
            applySqlIndexChanges.call(self, model, pendingChanges, done, idx + 1);
        });
    } else {
        done();
    }
}

PG.prototype.propertiesSQL = function(model) {
    const self = this;
    const sql = ['"id" SERIAL PRIMARY KEY'];
    Object.keys(this._models[model].properties).forEach(function(prop) {
        if (prop === 'id') return;
        sql.push('"' + prop + '" ' + self.propertySettingsSQL(model, prop));
    });
    return sql.join(',\n  ');

};

PG.prototype.propertySettingsSQL = function(model, propName) {
    // "UNIQUE" could be added here, but it is handled by the indexes code instead!
    const self = this;
    const p = self._models[model].properties[propName];
    let result = datatype(p) + ' ';
    if (!propertyCanBeNull.call(self, model, propName)) result = result + 'NOT NULL ';
    return result;
};

function propertyCanBeNull(model, propName) {
    const p = this._models[model].properties[propName];
    return !(p.allowNull === false || p['null'] === false);
}

function propertyIsUnique(model, propName) {
    const p = this._models[model].properties[propName];
    return p['unique'] === true;
}

function escape(val) {
    if (val === undefined || val === null) {
        return 'NULL';
    }

    switch (typeof val) {
        case 'boolean': return (val) ? 'true' : 'false';
        case 'number': return val + '';
    }

    if (typeof val === 'object') {
        val = (typeof val.toISOString === 'function')
      ? val.toISOString()
      : val.toString();
    }

    val = val.replace(/[\0\n\r\b\t\\\'\"\x1a]/g, function(s) {
        switch (s) {
            case '\0': return '\\0';
            case '\n': return '\\n';
            case '\r': return '\\r';
            case '\b': return '\\b';
            case '\t': return '\\t';
            case '\x1a': return '\\Z';
            default: return '\\' + s;
        }
    });
    return 'E\'' + val + '\'';
}

function datatype(p) {
    var sizeStr = (p.size?'('+p.size+')':'');
    switch (p.type.name) {
        default:
        case 'String':
        case 'JSON':
            return 'varchar'+sizeStr;
        case 'Text':
            return 'text'+sizeStr;
        case 'Number':
            switch (p.dataType) {
                case 'double':
                case 'float':
                    return 'float'+sizeStr;
                case 'numeric':
                  return 'numeric'+sizeStr;
                case 'integer':
                default:
                    return 'integer'+sizeStr;
            }
        case 'Date':
            return 'timestamp with time zone';
        case 'Boolean':
            return 'boolean';
    }
}

function mapPostgresDatatypes(typeName) {
    //TODO there are a lot of synonymous type names that should go here-- this is just what i've run into so far
    switch (typeName) {
        case 'int4':
            return 'integer';
        case 'bool':
            return 'boolean';
        case 'float8':
            return 'float';
        case 'timestamptz':
            return 'timestamp with time zone';
        default:
            return typeName;
    }
}

function propertyHasNotBeenDeleted(model, propName) {
    return !!this._models[model].properties[propName];
}

function indexHasNotBeenDeleted(model, indexName) {
    return !!this._models[model].settings.indexes[indexName];
}
