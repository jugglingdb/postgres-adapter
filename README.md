# JugglingDB-Postgres

This is a fork of the [postgres-adapter](https://github.com/jugglingdb/postgres-adapter) for jugglingdb. It includes the following features:

1. Support for `float` datatypes, ala the mysql adapter. Just add `dataType: 'double'` to your column properties:

  ```json
  var Model = schema.define('Model', {
    realNumber: {type: Number, dataType: 'double'}
  });
  ```
