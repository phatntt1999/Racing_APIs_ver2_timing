import express from 'express';
import cors from 'cors';
import https from 'https';
import fs from 'fs';
import dotenv from 'dotenv';

// This line imports the exported router, and names it movieRouter for this file
// Add this line to the top of index.js after importing express
import racesRouter from './races.js';
import tracksRouter from './tracks.js';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
dotenv.config();

const app = express();

const PORT = 3389;

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-KEY']
}));


// Load SSL certificate and key
const options = {
    key: fs.readFileSync('./key.pem'),    // Your private key file
    cert: fs.readFileSync('./cert.pem')    // Your certificate file
};

//parse JSON and URL encoded data
app.use(express.json());
app.use(express.urlencoded({extended: true}));

https.createServer(options, app).listen(PORT, () => {
    console.log(`HTTPS Server running on port ${PORT}`);
});

// This line tells Express to use the movie router for all routes beginning with "/movies"
// Add this line to the end of index.js
app.use("/race", racesRouter);
app.use("/track", tracksRouter);

