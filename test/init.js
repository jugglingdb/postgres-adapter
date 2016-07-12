var Schema = require('jugglingdb').Schema;
var fs = require('fs');

global.getSchema = function() {
    /*
        Config files are of this form. Provide other details if necessary.
        {
            "database": "<database name>"
            , "username": "<user>"
        }
    */
    var conf = JSON.parse(fs.readFileSync(__dirname + '/config.json'));
    if (process.env.POSTGRES_HOST) {
        conf.host = process.env.POSTGRES_HOST;
    }
    var db = new Schema(require('../'), conf
    );
    db.log = function (a) { console.log(a); };
    return db;
};
