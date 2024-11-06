import express from 'express';
import axios from 'axios';
import fs from 'fs';
import https from 'https';
import dbconn from './dbconn.js';

// Create an HTTPS agent with the certificate
const cert = fs.readFileSync('./cert.pem');

const httpsAgent = new https.Agent({
    ca: cert
});

const getRaces = (req, res) => {
    const raceQuery = `
        SELECT races.id AS race_id, races.track_id, tracks.name AS track_name, 
               races.entrants, races.starting_positions
        FROM races
        JOIN tracks ON races.track_id = tracks.id
    `;

    dbconn.query(raceQuery, (err, raceRows) => {
        if (err) {
            return res.status(500).json({
                code: 500,
                result: 'Server error while fetching races'
            });
        }

        // Extract race IDs to fetch all related laps
        const raceIds = raceRows.map(race => race.race_id);

        if (raceIds.length === 0) {
            return res.json({
                code: 200,
                result: []
            });
        }

        // Get all laps associated with the retrieved race IDs
        const lapQuery = `
            SELECT race_id, lap_number, entrant_index, lap_time, crashed
            FROM laps
            WHERE race_id IN (?)
            ORDER BY race_id, lap_number, entrant_index
        `;

        dbconn.query(lapQuery, [raceIds], (err, lapRows) => {
            if (err) {
                return res.status(500).json({
                    code: 500,
                    result: 'Server error while fetching lap data'
                });
            }

            // Organize laps by race_id
            const lapsByRace = lapRows.reduce((acc, row) => {
                if (!acc[row.race_id]) acc[row.race_id] = [];
                
                // Check if current lap is new, if so add a new lap entry
                const lastLap = acc[row.race_id][acc[row.race_id].length - 1];
                if (!lastLap || lastLap.number !== row.lap_number) {
                    acc[row.race_id].push({
                        number: row.lap_number,
                        lapTimes: []
                    });
                }

                // Add lap time to the current lap
                const currentLap = acc[row.race_id][acc[row.race_id].length - 1];
                currentLap.lapTimes.push({
                    entrant: row.entrant_index,
                    time: row.lap_time,
                    crashed: !!row.crashed
                });

                return acc;
            }, {});

            // Combine races with their laps

            const formattedRaces = raceRows.map(race => ({
                id: race.race_id,
                track: {
                    name: race.track_name,
                    uri: `https://lab-95a11ac6-8103-422e-af7e-4a8532f40144.australiaeast.cloudapp.azure.com:7090/track/${race.track_id}`
                },
                entrants: race.entrants,
                startingPositions: race.starting_positions,
                laps: lapsByRace[race.race_id] || []
            }));

            res.json({
                code: 200,
                result: formattedRaces
            });
        });
    });
};

const getRace = (req, res) => {
    const raceId = req.params.id; // Extract the race ID from the URL

    const raceQuery = `
        SELECT races.id AS race_id, races.track_id, tracks.name AS track_name, 
               races.entrants, races.starting_positions
        FROM races
        JOIN tracks ON races.track_id = tracks.id
        WHERE races.id = ?
    `;

    dbconn.query(raceQuery, [raceId], (err, raceRows) => {
        if (err) {
            return res.status(500).json({
                code: 500,
                message: 'Server error while fetching race details'
            });
        }

        // If no race is found with the specified ID
        if (raceRows.length === 0) {
            return res.status(404).json({
                code: 404,
                result: 'Race not found'
            });
        }

        const race = raceRows[0]; // Extract race details

        // Get lap details for the specific race
        const lapQuery = `
            SELECT lap_number, entrant_index, lap_time, crashed
            FROM laps
            WHERE race_id = ?
            ORDER BY lap_number, entrant_index
        `;

        dbconn.query(lapQuery, [raceId], (err, lapRows) => {
            if (err) {
                return res.status(500).json({
                    code: 500,
                    message: 'Server error while fetching lap data'
                });
            }

            const laps = [];
            let currentLap = null;

            lapRows.forEach(row => {
                // If this is a new lap, create a new lap entry
                if (!currentLap || currentLap.number !== row.lap_number) {
                    if (currentLap) laps.push(currentLap);
                    currentLap = { number: row.lap_number, lapTimes: [] };
                }

                // Add lap time for each entrant in the current lap
                currentLap.lapTimes.push({
                    entrant: row.entrant_index,
                    time: row.lap_time,
                    crashed: !!row.crashed
                });
            });

            if (currentLap) laps.push(currentLap); // Push the last lap data

            const formattedRace = {
                id: race.race_id,
                track: {
                    name: race.track_name,
                    uri: `https://lab-95a11ac6-8103-422e-af7e-4a8532f40144.australiaeast.cloudapp.azure.com:7090/track/${race.track_id}`
                },
                entrants: race.entrants,
                startingPositions: race.starting_positions,
                laps: laps
            };

            res.json({
                code: 200,
                result: formattedRace
            });
        });
    });
};

const qualifyRace = async (req, res) => {
    const raceId = req.params.id;

    const raceQuery = `
        SELECT id AS race_id, track_id, entrants, starting_positions
        FROM races
        WHERE id = ?
    `;

    dbconn.query(raceQuery, [raceId], async (err, raceRows) => {
        if (err) {
            // console.log(err)
            return res.status(500).json({
                code: 500,
                result: 'Server error while fetching race details'
            });
        }

        // Check if race exists and has entrants
        if (raceRows.length === 0) {
            return res.status(404).json({
                code: 404,
                result: 'Race not found'
            });
        }

        const race = raceRows[0];
        const entrants = race.entrants || [];
        const startingPositions = race.starting_positions || [];

        // Validate conditions for 400 Bad Request
        if (entrants.length === 0) {
            return res.status(400).json({
                code: 400,
                result: 'No entrants available for this race'
            });
        }
        if (startingPositions.length > 0) {
            return res.status(400).json({
                code: 400,
                result: 'Starting positions already populated'
            });
        }

        // Compare driver skill for each entrant
        const trackTypeQuery = `SELECT type FROM tracks WHERE id = ?`;
        const [[track]] = await dbconn.promise().query(trackTypeQuery, [race.track_id]);
        const trackType = track.type;

        // Prepare to fetch driver skill for each entrant
        const entrantsWithSkills = await Promise.all(
            entrants.map(async (entrantUri, index) => {
                try {
                    const response = await axios.get(entrantUri);

                    // Assume skill is 0 if we can't get skill info
                    const skill = response.status === 200
                        ? response.data.skill[trackType] || 0
                        : 0;

                    return { index, skill };
                } catch {
                    return { index, skill: 0 };
                }
            })
        );

        // Sort skill in descending order
        entrantsWithSkills.sort((a, b) => b.skill - a.skill);

        // Populate starting positions based on sorted skills
        const sortedPositions = entrantsWithSkills.map(entrant => entrant.index);

        const updateQuery = `
            UPDATE races
            SET starting_positions = ?
            WHERE id = ?
        `;
        dbconn.query(updateQuery, [JSON.stringify(sortedPositions), raceId], (err) => {
            if (err) {
                return res.status(500).json({
                    code: 500,
                    result: 'Server error while updating starting positions'
                });
            }

            // Success response
            res.status(200).json({
                code: 200,
                result: 'Starting positions assigned successfully'
            });
        });
    });
};

const getEntrants = async (req, res) => {
    const raceId = req.params.id;

    try {
        const raceQuery = `SELECT entrants, starting_positions FROM races WHERE id = ?`;
        const [raceRows] = await dbconn.promise().query(raceQuery, [raceId]);

        if (raceRows.length === 0) {
            return res.status(404).json({ code: 404, message: 'Race not found' });
        }

        const race = raceRows[0];
        const entrants = race.entrants;
        const startingPositions = race.starting_positions;

        const entrantDetails = await Promise.all(
            entrants.map(async (carUri, index) => {
                try {
                    const response = await axios.get(carUri);
                    const driverData = response.data.result.driver;

                    return {
                        number: driverData.number,
                        shortName: driverData.shortName,
                        name: driverData.name,
                        uri: carUri,
                        startingPosition: startingPositions[index]
                    };
                } catch (err) {
                    // console.error(`Error fetching driver info for car ${carUri}:`, err.message);
                    return {
                        number: null,
                        shortName: 'Unknown',
                        name: 'Unknown',
                        uri: carUri,
                        startingPosition: startingPositions[index]
                    };
                }
            })
        );

        res.status(200).json({
            code: 200,
            result: entrantDetails
        });

    } catch (error) {
        res.status(500).json({
            code: 500,
            result: 'Server error while retrieving entrant data'
        });
    }
};

const createEntrant = async (req, res) => {
    const raceId = req.params.id;
    const { entrant: carUri } = req.body;

    const raceQuery = `
        SELECT races.entrants, races.starting_positions, races.track_id
        FROM races
        WHERE id = ?
    `;

    try {
        const [[race]] = await dbconn.promise().query(raceQuery, [raceId]);

        if (!race) {
            return res.status(404).json({
                code: 404,
                result: 'Race not found'
            });
        }

        const entrants = race.entrants || [];
        const startingPositions = race.starting_positions || [];

        // Check if qualifying has already taken place
        if (startingPositions.length > 0) {
            return res.status(400).json({
                code: 400,
                result: 'Cannot add entrants after qualifying has taken place'
            });
        }

        // Check if the entrant (car URI) already exists in the entrants array
        if (entrants.includes(carUri)) {
            return res.status(400).json({
                code: 400,
                result: 'Entrant with the same URI already exists'
            });
        }

        // Get the car details to validate driver number, suitability, and skills
        const response = await axios.get(carUri, { httpsAgent });
        if (response.status !== 200) {
            return res.status(400).json({
                code: 400,
                result: 'Error fetching car details, car does not exist or API returned an error'
            });
        }

        const {result: carData} = response.data;
        if (!carData.driver) {
            return res.status(400).json({
                code: 400,
                result: 'The car you are attempting to enter has no driver'
            });
        }

        // Check for unique driver number among existing entrants
        const driverNumber = carData.driver.number;

        for (let entrantUri of entrants) {
            const entrantResponse = await axios.get(entrantUri);

            if (entrantResponse.status === 200 && entrantResponse.data.result.driver?.number === driverNumber) {
                return res.status(400).json({
                    code: 400,
                    result: `Driver with number ${driverNumber} already exists in the race`
                });
            }
        }

        entrants.push(carUri);

        const updateQuery = `
            UPDATE races
            SET entrants = ?
            WHERE id = ?
        `;
        await dbconn.promise().query(updateQuery, [JSON.stringify(entrants), raceId]);

        res.status(200).json({
            code: 200,
            result: 'Entrant added successfully'
        });

    } catch (err) {
        console.log(err)
        res.status(500).json({
            code: 500,
            result: 'Server error while adding entrant',
        });
    }
};

const deleteEntrant = async (req, res) => {
    const raceId = req.params.id;
    const carURI = req.query.carURI;

    try {
        const raceQuery = `SELECT entrants, starting_positions FROM races WHERE id = ?`;
        const [raceRows] = await dbconn.promise().query(raceQuery, [raceId]);

        if (raceRows.length === 0) {
            return res.status(404).json({ code: 404, message: 'Race not found' });
        }

        const race = raceRows[0];
        const entrants = race.entrants;
        const startingPositions = race.starting_positions;

        // Find the index of the car to delete
        const entrantIndex = entrants.indexOf(carURI);
        if (entrantIndex === -1) {
            return res.status(404).json({ code: 404, message: 'Entrant not found in this race' });
        }

        // Delete the entrant and its starting position
        entrants.splice(entrantIndex, 1);
        startingPositions.splice(entrantIndex, 1);

        const updateQuery = `UPDATE races SET entrants = ?, starting_positions = ? WHERE id = ?`;
        await dbconn.promise().query(updateQuery, [
            JSON.stringify(entrants),
            JSON.stringify(startingPositions),
            raceId
        ]);

        res.status(200).json({
            code: 200,
            result: 'Delete entrant successfully'
        });

    } catch (error) {
        res.status(500).json({
            code: 500,
            message: 'Server error while removing entrant'
        });
    }
};

const getLapOfRace = async (req, res) => {
    const raceId = req.params.id;

    try {
        const lapQuery = `
            SELECT lap_number, entrant_index, lap_time, crashed
            FROM laps
            WHERE race_id = ?
            ORDER BY lap_number, entrant_index
        `;

        const [lapRows] = await dbconn.promise().query(lapQuery, [raceId]);

        if (lapRows.length === 0) {
            return res.status(404).json({
                code: 404,
                result: 'No lap data found for this race'
            });
        }

        res.status(200).json({
            code: 200,
            result: lapRows
        });

    } catch (error) {
        res.status(500).json({
            code: 500,
            result: 'Server error while retrieving laps data'
        });
    }
};

const recordLap = async (req, res) => {
    const raceId = req.params.id;

    const raceQuery = `
        SELECT races.entrants, races.starting_positions, races.track_id, laps.lap_number
        FROM races
        LEFT JOIN laps ON races.id = laps.race_id
        WHERE races.id = ?
    `;

    try {
        const [raceRows] = await dbconn.promise().query(raceQuery, [raceId]);
        
        if (raceRows.length === 0 || !raceRows[0].entrants) {
            return res.status(400).json({
                code: 400,
                result: 'No entrants available for this race'
            });
        }

        const race = raceRows[0];
        const entrants = race.entrants;
        const startingPositions = race.starting_positions || [];

        if (startingPositions.length === 0) {
            return res.status(400).json({
                code: 400,
                result: 'Starting positions have not been populated yet'
            });
        }

        // Get next lap number
        const lastLapNumber = Math.max(...raceRows.map(row => row.lap_number || 0));
        const nextLapNumber = lastLapNumber + 1;

        // Track details
        const trackQuery = `SELECT type AS trackType, laps AS total_laps, baseLapTime FROM tracks WHERE id = ?`;
        const [[track]] = await dbconn.promise().query(trackQuery, [race.track_id]);
        if (nextLapNumber > track.total_laps) {
            return res.status(400).json({
                code: 400,
                result: 'Exceeding total number of laps for the track'
            });
        }

        // Run each car's lap for the race
        const lapResults = await Promise.all(entrants.map(async (carUri, index) => {
            try {
                // Only request lap info if the car hasn't crashed in previous laps
                const lapResponse = await axios.get(`${carUri}/lap`, {
                    params: {
                        baseLapTime: track.baseLapTime,
                        trackType: track.trackType
                    }
                });

                if (lapResponse.data.result.crashed === false) {
                    const { time, randomness, crashed } = lapResponse.data.result;

                    const totalLapTime = parseFloat(time) + parseFloat(randomness); // Total lap time

                    return {
                        entrant: startingPositions[index],
                        lap_number: nextLapNumber,
                        time: crashed ? 0 : totalLapTime,
                        crashed: false
                    };
                } else {
                    // If the response is not 200, behave as the car has crashed
                    return {
                        entrant: startingPositions[index],
                        lap_number: nextLapNumber,
                        time: 0,
                        crashed: true
                    };
                }
            } catch (err) {
                // If a request turns error, behave the car as crashed
                return {
                    entrant: startingPositions[index],
                    lap_number: nextLapNumber,
                    time: 0,
                    crashed: true
                };
            }
        }));

        const insertQuery = `
            INSERT INTO laps (race_id, lap_number, entrant_index, lap_time, crashed)
            VALUES ?
        `;

        const lapData = lapResults.map(result => [
            raceId,
            result.lap_number,
            result.entrant,
            result.time,
            result.crashed
        ]);

        await dbconn.promise().query(insertQuery, [lapData]);

        res.status(200).json({
            code: 200,
            result: 'Lap recorded successfully'
        });

    } catch (err) {
        res.status(500).json({
            code: 500,
            result: 'Server error while recording lap'
        });
    }
};

const getLeaderboard = async (req, res) => {
    const raceId = req.params.id;

    try {
        const raceQuery = `SELECT entrants, starting_positions FROM races WHERE id = ?`;
        const [raceRows] = await dbconn.promise().query(raceQuery, [raceId]);

        if (raceRows.length === 0) {
            return res.status(404).json({ code: 404, result: 'Race not found' });
        }

        const race = raceRows[0];
        const entrants = race.entrants;
        const startingPositions = race.starting_positions;
        // Set leaderboard with base times
        const leaderboard = entrants.map((carUri, index) => ({
            uri: carUri,
            laps: 0,
            time: startingPositions[index] * 5 // Base time based on starting position
        }));

        const lapQuery = `SELECT entrant_index, lap_number, lap_time, crashed FROM laps WHERE race_id = ? ORDER BY lap_number, entrant_index`;
        const [lapRows] = await dbconn.promise().query(lapQuery, [raceId]);

        // Loop each lap and update the leaderboard data
        lapRows.forEach(lap => {
            const car = leaderboard[lap.entrant_index];
            if (car && !lap.crashed) {
                car.laps += 1;
                car.time += parseFloat(lap.lap_time);
            }
        });

        // Get driver information on each car URI
        const driverInfo = await Promise.all(
            leaderboard.map(async (car, index) => {
                try {
                    const response = await axios.get(car.uri + "/driver");
                    const driverData = response.data.result;

                    return {
                        ...car,
                        number: driverData.number,
                        shortName: driverData.shortName,
                        name: driverData.name,
                        uri: car.uri
                    };
                } catch (error) {
                    // console.error(`Error fetching driver info for car ${car.uri}:`, error.message);
                    return {
                        ...car,
                        number: null,
                        shortName: 'Unknown',
                        name: 'Unknown',
                        uri: car.uri
                    };
                }
            })
        );

        // Sort leaderboard by laps completed and time
        driverInfo.sort((a, b) => {
            if (b.laps !== a.laps) return b.laps - a.laps; // Compare more laps completed first
            return a.time - b.time; // Compare lower time in case of a tie lap
        });

        // Determine the latest lap in the laps data
        const latestLap = lapRows.length ? Math.max(...lapRows.map(lap => lap.lap_number)) : 0;

        res.status(200).json({
            code: 200,
            result: {
                lap: latestLap,
                entrants: driverInfo
            }
        });

    } catch (err) {
        res.status(500).json({
            code: 500,
            result: 'Server error while calculating leaderboard'
        });
    }
};

const getLapLeaderboard = async (req, res) => {
    const raceId = req.params.id;
    const lapLimit = parseInt(req.params.number, 10);

    try {
        const raceQuery = `SELECT entrants, starting_positions FROM races WHERE id = ?`;
        const [raceRows] = await dbconn.promise().query(raceQuery, [raceId]);

        if (raceRows.length === 0) {
            return res.status(404).json({ code: 404, result: 'Race not found' });
        }

        const race = raceRows[0];
        const entrants = race.entrants;
        const startingPositions = race.starting_positions;
        // Set leaderboard with base times
        const leaderboard = entrants.map((carUri, index) => ({
            uri: carUri,
            laps: 0,
            time: startingPositions[index] * 5 // Base time based on starting position
        }));

        
        const lapQuery = `
            SELECT entrant_index, lap_number, lap_time, crashed
            FROM laps
            WHERE race_id = ? AND lap_number <= ?
            ORDER BY lap_number, entrant_index
        `;
        const [lapRows] = await dbconn.promise().query(lapQuery, [raceId, lapLimit]);

        // Loop each lap and update the leaderboard data
        lapRows.forEach(lap => {
            const car = leaderboard[lap.entrant_index];
            if (car && !lap.crashed) {
                car.laps += 1;
                car.time += parseFloat(lap.lap_time);
            }
        });

        // Get driver information on each car URI
        const driverInfo = await Promise.all(
            leaderboard.map(async (car, index) => {
                try {
                    const response = await axios.get(car.uri + "/driver");
                    const driverData = response.data.result;

                    return {
                        ...car,
                        number: driverData.number,
                        shortName: driverData.shortName,
                        name: driverData.name,
                        uri: car.uri
                    };
                } catch (error) {
                    // console.error(`Error fetching driver info for car ${car.uri}:`, error.message);
                    return {
                        ...car,
                        number: null,
                        shortName: 'Unknown',
                        name: 'Unknown',
                        uri: car.uri
                    };
                }
            })
        );

        // Sort leaderboard by laps completed and time
        driverInfo.sort((a, b) => {
            if (b.laps !== a.laps) return b.laps - a.laps; // Compare more laps completed first
            return a.time - b.time; // Compare lower time in case of a tie lap
        });

        res.status(200).json({
            code: 200,
            result: {
                lap: lapLimit,
                entrants: driverInfo
            }
        });

    } catch (err) {
        // console.log(err)
        res.status(500).json({
            code: 500,
            result: 'Server error while calculating leaderboard'
        });
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

// // Define a router for all the routes about Races
const router = express.Router();
router.get('/', getRaces);
router.get('/:id', getRace);
router.get('/:id/entrant', getEntrants);
router.post('/:id/entrant', checkApiKey, createEntrant);
router.delete('/:id/entrant', checkApiKey, deleteEntrant);
router.get('/:id/lap', getLapOfRace);
router.post('/:id/lap', checkApiKey, recordLap);
router.post('/:id/qualify', checkApiKey, qualifyRace);
router.get('/:id/leaderboard', getLeaderboard);
router.get('/:id/lap/:number', getLapLeaderboard);

// // Make the router available to other modules via export/import
export default router;
