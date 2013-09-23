var Schema = require('jugglingdb').Schema;
var fs = require('fs');

global.getSchema = function() {
    var db = new Schema(require('../')
    	, JSON.parse(fs.readFileSync(__dirname + '/config.json'))
    	/*
			Config files are of this form. Provide other details if necessary.
		    {
		  		"database": "<database name>"
		  		, "username": "<user>"
			}
    	*/
    );
    db.log = function (a) { console.log(a); };
    return db;
};
