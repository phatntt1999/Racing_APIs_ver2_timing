import express from 'express';
import puppeteer from 'puppeteer';

import dbconn from './dbconn.js';

const getTracks = (req, res) => {
    dbconn.query('SELECT * FROM tracks', (err, rows) => {
        if (err) {
            return res.status(500).json({
                code: 500,
                message: 'Server error',
            });
        }

        // Format the response
        const formattedTracks = rows.map(track => ({
            id: track.id,
            name: track.name,
            type: track.type,
            laps: track.laps,
            baseLapTime: parseFloat(track.baseLapTime) // Convert to float for decimal precision
        }));

        // Send the response with the formatted track data
        res.json({
            code: 200,
            result: formattedTracks
        });
    });
}

const createTrack = (req, res) => {
    const { name, type, laps, baseLapTime } = req.body;

    // Validate required fields
    const isExistParam = isExistParams(name, type, laps, baseLapTime);
    if (!isExistParam.valid) {
        return res.status(400).json({
            code: 400,
            result: isExistParam.message
        });
    }

    // Validate type (should be either 'race' or 'street')
    if (type !== 'race' && type !== 'street') {
        return res.status(400).json({
            code: 400,
            result: "Invalid type'"
        });
    }

    // Validate laps (positive integer)
    const lapsNumber = parseInt(laps, 10);
    if (typeof lapsNumber !== 'number' || lapsNumber <= 0) {
        return res.status(400).json({
            code: 400,
            result: 'laps must be a positive integer'
        });
    }

    // Validate baseLapTime (positive decimal)
    const baseLapTimeFloat = parseFloat(baseLapTime);
    if (typeof baseLapTimeFloat !== 'number' || baseLapTimeFloat <= 0) {
        return res.status(400).json({
            code: 400,
            result: 'baseLapTime must be a positive number'
        });
    }

    // SQL query to insert a new track
    const query = `
        INSERT INTO tracks (name, type, laps, baseLapTime)
        VALUES (?, ?, ?, ?)
    `;

    // Insert the new track into the database
    dbconn.query(query, [name, type, lapsNumber, baseLapTimeFloat], (err, result) => {
        if (err) {
            return res.status(500).json({
                code: 500,
                result: 'Undefined server error while creating track',
            });
        }

        // Success response with the new track's ID
        res.status(200).json({
            code: 200,
            result: 'Track created',
        });
    });
};

const getTrack = (req, res) => {
    const trackId = req.params.id;

    const query = `
        SELECT id, name, type, laps, baseLapTime
        FROM tracks
        WHERE id = ?
    `;

    dbconn.query(query, [trackId], (err, rows) => {
        if (err) {
            return res.status(500).json({
                code: 500,
                result: 'Server error',
            });
        }

        if (rows.length === 0) {
            return res.status(404).json({
                code: 404,
                result: 'Track not found'
            });
        }

        const track = rows[0];

        const formattedTrack = {
            id: track.id,
            name: track.name,
            type: track.type,
            laps: track.laps,
            baseLapTime: parseFloat(track.baseLapTime)
        };

        res.json({
            code: 200,
            result: formattedTrack
        });
    });
};

const deleteTrack = async (req, res) => {
    const trackId = req.params.id;

    try {
        // Check if there are any races associated with this track
        const raceQuery = `SELECT COUNT(*) AS raceCount FROM races WHERE track_id = ?`;
        const [raceRows] = await dbconn.promise().query(raceQuery, [trackId]);

        if (raceRows[0].raceCount > 0) {
            return res.status(400).json({
                code: 400,
                result: 'Track cannot be deleted as it has associated races.'
            });
        }

        const deleteQuery = `DELETE FROM tracks WHERE id = ?`;
        await dbconn.promise().query(deleteQuery, [trackId]);

        res.status(200).json({
            code: 200,
            result: 'Track deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            code: 500,
            result: 'Server error while attempting to delete track',
            error: error.message
        });
    }
};

const getTrackRaces = async (req, res) => {
    const trackId = req.params.id;

    try {
        const trackRaceQuery = `
            SELECT 
                tracks.name AS trackName, 
                tracks.type AS trackType, 
                tracks.laps AS totalLaps, 
                tracks.baseLapTime AS baseLapTime,
                races.id AS raceId,
                races.entrants,
                races.starting_positions
            FROM tracks
            LEFT JOIN races ON races.track_id = tracks.id
            WHERE tracks.id = ?
        `;
        const [rows] = await dbconn.promise().query(trackRaceQuery, [trackId]);

        if (rows.length === 0) {
            return res.status(404).json({
                code: 404,
                message: 'No races or track data found for this track ID'
            });
        }

        const raceInfo = {
            track_name: rows[0].trackName,
            track_type: rows[0].trackType,
            track_laps: rows[0].totalLaps,
            track_baseLapTime: rows[0].baseLapTime,
            races: rows.map(row => ({
                raceId: row.raceId,
                entrants: row.entrants,
                startingPositions: row.starting_positions
            }))
        };

        res.status(200).json({
            code: 200,
            result: raceInfo
        });

    } catch (error) {
        res.status(500).json({
            code: 500,
            result: 'Server error while retrieving track and race data'
        });
    }
};

const scrapeTracks = async (req, res) => {
    try {
        // Launch Puppeteer
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto('https://www.formula1.com/en/racing/2024', { waitUntil: 'networkidle2' });

        // Wait for the elements to load on the page
        await page.waitForSelector('.event-item-wrapper');

        // Scrape the data
        const tracks = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.event-item-wrapper')).map(trackElement => {
                const name = trackElement.querySelector('.event-title')?.textContent.trim() || 'N/A';
                const lapsText = trackElement.querySelector('.laps')?.textContent.trim() || 'N/A';
                const fastestLapText = trackElement.querySelector('.fastest-lap')?.textContent.trim() || 'N/A';
                const circuitInfo = trackElement.querySelector('.circuit-info')?.textContent.toLowerCase() || '';

                // Extract lap count
                const laps = parseInt(lapsText.match(/\d+/)?.[0] || '0', 10);

                // Convert fastest lap to seconds for baseLapTime
                const fastestLapParts = fastestLapText.match(/(\d+):(\d+\.\d+)/);
                const baseLapTime = fastestLapParts
                    ? parseInt(fastestLapParts[1], 10) * 60 + parseFloat(fastestLapParts[2])
                    : 0;

                // Determine track type
                const type = circuitInfo.includes('street') ? 'street' : 'race';

                return {
                    name,
                    laps,
                    baseLapTime,
                    type
                };
            });
        });

        await browser.close();

        res.status(200).json({
            code: 200,
            result: tracks
        });
    } catch (error) {
        console.error('Error scraping tracks:', error);
        res.status(500).json({
            code: 500,
            result: 'Error occurred while scraping track data'
        });
    }
};

const createTrackRace = async (req, res) => {
    const trackId = req.params.id;
    
    // Verify that the track exists
    try {
        const [[track]] = await dbconn.promise().query(
            `SELECT id FROM tracks WHERE id = ?`,
            [trackId]
        );

        if (!track) {
            return res.status(404).json({
                code: 404,
                result: 'Track not found'
            });
        }
    } catch (err) {
        return res.status(500).json({
            code: 500,
            result: 'Server error while checking track'
        });
    }

    // Insert the new race
    try {
        const insertQuery = `
            INSERT INTO races (track_id)
            VALUES (?)
        `;

        // Convert entrants to JSON and initialize starting_positions as an empty JSON array
        const [result] = await dbconn.promise().query(insertQuery, [
            trackId
        ]);

        res.status(200).json({
            code: 200,
            result: 'Race created.',
        });
    } catch (err) {
        return res.status(500).json({
            code: 500,
            result: 'Server error while creating race'
        });
    }
};

const isExistParams = (name, type, laps, baseLapTime) => {
    let isValid = true;
    let message = "";

    if (!name) {
        isValid = false;
        message = "Name is required."
    } else if (!type) {
        isValid = false;
        message = "Type is required."
    } else if (!laps) {
        isValid = false;
        message = "Labs count is required."
    } else if (!baseLapTime) {
        isValid = false;
        message = "Base Lap Time is required."
    }
    
    return {
        valid: isValid,
        message: message
    }
};

const checkApiKey = (req, res, next) => {
    const apiKey = req.header('x-api-key');

    // Check if API key is present and matches the stored key
    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({ code: 401, result: 'Unauthorized' });
    }

    next();
};

// Define a router for all the routes about Tracks
const router = express.Router();
router.get('/', getTracks);
router.get('/scrape', scrapeTracks);
router.get('/:id', getTrack);
router.post('/', checkApiKey, createTrack);
router.delete('/:id', checkApiKey, deleteTrack);
router.get('/:id/races', getTrackRaces);
router.post('/:id/races', checkApiKey, createTrackRace);

// Make the router available to other modules via export/import
export default router;