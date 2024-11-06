// Duplicate this file with the new name db_conn to connect db

import mysql from 'mysql';

// MySQL Config
var con = mysql.createConnection({ 
    user: "DB user here",
    password: "password for the user", 
    database: "database name"
});

// Connect to MySQL
con.connect(function(err) {
    if (err) throw err;
    console.log("MySQL Connected!");
});

// Make the connection available to other modules via export/import
export default con;