## JugglingDB-Postgres [![Build Status](https://travis-ci.org/jugglingdb/postgres-adapter.png)](https://travis-ci.org/jugglingdb/postgres-adapter)

PostgreSQL adapter for JugglingDB.

## Usage

To use it you need `jugglingdb@0.2.x`.

1. Setup dependencies in `package.json`:

    ```json
    {
      ...
      "dependencies": {
        "jugglingdb": "0.2.x",
        "jugglingdb-postgres": "latest"
      },
      ...
    }
    ```

2. Use:

    ```javascript
        var Schema = require('jugglingdb').Schema;
        var schema = new Schema('postgres', {
            database: 'myapp_test',
            username: 'postgres'
            // host: 'localhost',
            // port: 5432,
            // password: s.password,
            // database: s.database,
            // ssl: true,
            // debug: false
        });
    ```

### Additional Features

1. Support for `float` datatypes, ala the mysql adapter. Just add `dataType: 'float'` to your column properties:

  ```javascript
  var Model = schema.define('Model', {
    realNumber: {type: Number, dataType: 'float'}
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

## Running tests

    npm test

## MIT License

    Copyright (C) 2012 by Anatoliy Chakkaev
    
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    
    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.
    
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
    THE SOFTWARE.

