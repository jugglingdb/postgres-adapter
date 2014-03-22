# JugglingDB-Postgres

This is a fork of the [postgres-adapter](https://github.com/jugglingdb/postgres-adapter) for jugglingdb. The latest sync with the upstream branch was March 22nd, 2014.

This fork includes the following features:

1. Support for `float` datatypes, ala the mysql adapter. Just add `dataType: 'double'` to your column properties:

  ```javascript
  var Model = schema.define('Model', {
    realNumber: {type: Number, dataType: 'double'}
  });
  ```

2. Support for single and multi-column indexes, ala the mysql adapter. Single column indexes are specified by adding `index: true` to the column properties. Unique single-column indexes are created by adding `unique: true` to the column properties (it is unnecessary to also specify `index: true` since it is implied). Multi-column indexes are added by specifying `indexes` in the settings hash of the `schema.define` method. Single-column indexes may also be specified this way if you want to have a little more control over their options. Each key in the `indexes` hash is the name of the index, and the value is a hash which specifies the index properties:

  ```javascript
  var Model = schema.define('Model', {
    column1: {type: Number, index: true},
    column2: {type: Number}
  }, {
    indexes: {
      indexName1: {
        columns: 'column1, column2',
        type: 'btree'
      }
    }
  });
  ```
  
  The full list of supported index properties are:
  
  ```javascript
  {
    columns: 'comma, delimited, list, of, columns',
    keys: ['array', 'of', 'columns'],   // takes precedence over "columns"!
    type: 'TYPE',                       // 'btree', 'hash', etc
    kind: 'KIND'                        // 'unique' is the only valid option
  }
  ```
  
  See the [postgres documentation](http://www.postgresql.org/docs/9.1/static/sql-createindex.html) for more information about `type` and `kind`.