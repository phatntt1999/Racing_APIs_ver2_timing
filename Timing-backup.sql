CREATE TABLE tracks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type ENUM('race', 'street') NOT NULL,
    laps INT NOT NULL,
    baseLapTime DECIMAL(6, 3) NOT NULL
);

INSERT INTO tracks (name, type, laps, baseLapTime)
VALUES 
('Monaco', 'street', 78, 72.909),
('Silverstone', 'race', 52, 88.321),
('Suzuka', 'race', 53, 92.514);

-- Races table with JSON fields for entrants and starting positions
CREATE TABLE races (
    id INT AUTO_INCREMENT PRIMARY KEY,
    track_id INT NOT NULL,
    entrants JSON,            -- JSON array of car URLs
    starting_positions JSON,  -- JSON array indicating starting positions
    FOREIGN KEY (track_id) REFERENCES tracks(id)
);

INSERT INTO races (track_id, entrants, starting_positions) VALUES
(1, JSON_ARRAY('https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/1', 'https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/2', 'https://AnotherTeamVM/car/3'),
JSON_ARRAY(0, 1, 2)),

(2, JSON_ARRAY('https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/4', 'https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/5', 'https://AnotherTeamVM/car/6', 'https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/7'),
JSON_ARRAY(1, 0, 2, 3)),

(3, JSON_ARRAY('https://AnotherTeamVM/car/8', 'https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/9', 'https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/10'),
JSON_ARRAY(2, 1, 0)),

(1, JSON_ARRAY('https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/11', 'https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/12'),
JSON_ARRAY(0, 1)),

(2, JSON_ARRAY('https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/13', 'https://AnotherTeamVM/car/14', 'https://lab-d00a6b41-7f81-4587-a3ab-fa25e5f6d9cf.australiaeast.cloudapp.azure.com:7101/car/15'),
JSON_ARRAY(1, 0, 2));

-- Laps table, combining race lap data and lap times for each entrant
CREATE TABLE laps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    race_id INT NOT NULL,
    lap_number INT NOT NULL,           -- The lap number within the race
    entrant_index INT NOT NULL,        -- Index referring to the car in the entrants array
    lap_time DECIMAL(6, 3) NOT NULL,   -- Time in seconds for this lap
    crashed BOOLEAN NOT NULL DEFAULT FALSE, -- Indicates if the car crashed in this lap
    FOREIGN KEY (race_id) REFERENCES races(id),
    UNIQUE (race_id, lap_number, entrant_index) -- Ensures unique lap entry for each car in a lap
);

INSERT INTO laps (race_id, lap_number, entrant_index, lap_time, crashed) VALUES
-- Race 1, Lap 0
(1, 0, 0, 75.123, FALSE),
(1, 0, 1, 0, TRUE),     -- Crashed
(1, 0, 2, 80.456, FALSE),

-- Race 1, Lap 1
(1, 1, 0, 74.789, FALSE),
(1, 1, 1, 0, TRUE),     -- Crashed
(1, 1, 2, 78.123, FALSE),

-- Race 2, Lap 0
(2, 0, 0, 76.654, FALSE),
(2, 0, 1, 77.321, FALSE),
(2, 0, 2, 79.876, FALSE),
(2, 0, 3, 82.555, FALSE),

-- Race 2, Lap 1
(2, 1, 0, 75.432, FALSE),
(2, 1, 1, 0, TRUE),     -- Crashed
(2, 1, 2, 78.111, FALSE),
(2, 1, 3, 81.333, FALSE),

-- Race 3, Lap 0
(3, 0, 0, 74.222, FALSE),
(3, 0, 1, 76.987, FALSE),
(3, 0, 2, 73.456, FALSE),

-- Race 3, Lap 1
(3, 1, 0, 74.567, FALSE),
(3, 1, 1, 76.123, FALSE),
(3, 1, 2, 0, TRUE),     -- Crashed

-- Race 4, Lap 0
(4, 0, 0, 75.888, FALSE),
(4, 0, 1, 80.999, FALSE),

-- Race 5, Lap 0
(5, 0, 0, 77.555, FALSE),
(5, 0, 1, 79.444, FALSE),
(5, 0, 2, 81.222, FALSE),

-- Race 5, Lap 1
(5, 1, 0, 76.111, FALSE),
(5, 1, 1, 78.333, FALSE),
(5, 1, 2, 0, TRUE);     -- Crashed