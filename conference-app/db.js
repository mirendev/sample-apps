const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = '/miren/data/local';
const dbFile = path.join(dbPath, 'conference.db');

if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(dbPath, { recursive: true });
}

const db = new sqlite3.Database(dbFile);

const init = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Enable WAL mode for better concurrency
      db.run('PRAGMA journal_mode = WAL', err => {
        if (err) {
          console.error('Warning: Could not enable WAL mode:', err);
          // Continue anyway - the app will work without WAL
        } else {
          console.log('SQLite WAL mode enabled for better concurrency');
        }
      });

      // Set busy timeout to 5 seconds to handle concurrent access
      db.run('PRAGMA busy_timeout = 5000', err => {
        if (err) {
          console.error('Warning: Could not set busy timeout:', err);
        }
      });

      // Optimize for better performance with multiple instances
      db.run('PRAGMA synchronous = NORMAL', err => {
        if (err) {
          console.error('Warning: Could not set synchronous mode:', err);
        }
      });
      db.run(
        `
        CREATE TABLE IF NOT EXISTS talks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          speaker TEXT NOT NULL,
          description TEXT,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          room TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
        err => {
          if (err) return reject(err);
        }
      );

      db.run(
        `
        CREATE TABLE IF NOT EXISTS attendees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
        err => {
          if (err) return reject(err);
        }
      );

      db.run(
        `
        CREATE TABLE IF NOT EXISTS registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attendee_id INTEGER NOT NULL,
          talk_id INTEGER NOT NULL,
          registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (attendee_id) REFERENCES attendees(id),
          FOREIGN KEY (talk_id) REFERENCES talks(id),
          UNIQUE(attendee_id, talk_id)
        )
      `,
        err => {
          if (err) return reject(err);
        }
      );

      db.run(
        `
        CREATE TABLE IF NOT EXISTS conference_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          conference_name TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
        err => {
          if (err) return reject(err);
        }
      );

      db.get('SELECT COUNT(*) as count FROM talks', (err, row) => {
        if (err) return reject(err);

        if (row.count === 0) {
          const sampleTalks = [
            {
              title: 'Opening Keynote',
              speaker: 'Jane Smith',
              description: 'Welcome to the conference and overview of the day',
              start_time: '09:00',
              end_time: '10:00',
              room: 'Main Hall'
            },
            {
              title: 'Introduction to Web Development',
              speaker: 'John Doe',
              description: 'Learn the basics of modern web development',
              start_time: '10:30',
              end_time: '11:30',
              room: 'Room A'
            },
            {
              title: 'Database Design Best Practices',
              speaker: 'Alice Johnson',
              description: 'Tips and tricks for effective database design',
              start_time: '10:30',
              end_time: '11:30',
              room: 'Room B'
            }
          ];

          const stmt = db.prepare(`
            INSERT INTO talks (title, speaker, description, start_time, end_time, room)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          sampleTalks.forEach(talk => {
            stmt.run(
              talk.title,
              talk.speaker,
              talk.description,
              talk.start_time,
              talk.end_time,
              talk.room
            );
          });

          stmt.finalize();
        }

        // Check if conference name exists
        db.get('SELECT COUNT(*) as count FROM conference_settings', (err, row) => {
          if (err) return reject(err);

          if (row.count === 0) {
            // Generate a random conference name
            const prefixes = ['Mega', 'Ultra', 'Hyper', 'Quantum', 'Cosmic'];
            const middles = ['Code', 'Tech', 'Dev', 'Hack', 'Data'];
            const suffixes = ['Con', 'Fest', 'Summit', 'Palooza', 'Conf'];
            const years = ['2024', '3000', 'Infinity', 'Forever', 'Ultimate'];

            const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
            const middle = middles[Math.floor(Math.random() * middles.length)];
            const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
            const year = years[Math.floor(Math.random() * years.length)];

            const conferenceName = `${prefix} ${middle} ${suffix} ${year}`;

            db.run(
              'INSERT INTO conference_settings (id, conference_name) VALUES (1, ?)',
              [conferenceName],
              err => {
                if (err) return reject(err);
                resolve();
              }
            );
          } else {
            resolve();
          }
        });
      });
    });
  });
};

// Helper function to retry database writes on SQLITE_BUSY errors
const retryOperation = (operation, maxRetries = 3, delay = 100) => {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const startTime = Date.now();

    const attempt = () => {
      attempts++;
      operation((err, result) => {
        if (err) {
          if (
            (err.code === 'SQLITE_BUSY' || err.message.includes('BUSY')) &&
            attempts < maxRetries
          ) {
            console.log(`[DB] BUSY - Retrying... (attempt ${attempts}/${maxRetries})`);
            setTimeout(attempt, delay * attempts); // Exponential backoff
          } else {
            console.error(`[DB] ERROR after ${attempts} attempts:`, err.message);
            reject(err);
          }
        } else {
          const duration = Date.now() - startTime;
          if (duration > 100) {
            console.log(
              `[DB] Slow operation completed in ${duration}ms after ${attempts} attempts`
            );
          }
          resolve(result);
        }
      });
    };

    attempt();
  });
};

const getAllTalks = callback => {
  db.all('SELECT * FROM talks ORDER BY start_time', callback);
};

const createTalk = (talk, callback) => {
  const { title, speaker, description, start_time, end_time, room } = talk;
  const operation = cb => {
    db.run(
      `INSERT INTO talks (title, speaker, description, start_time, end_time, room)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, speaker, description, start_time, end_time, room],
      function (err) {
        cb(err, { id: this.lastID });
      }
    );
  };

  if (callback) {
    // Legacy callback style
    retryOperation(operation)
      .then(result => callback(null, result))
      .catch(err => callback(err));
  } else {
    // Return promise for modern usage
    return retryOperation(operation);
  }
};

const updateTalk = (id, talk, callback) => {
  const { title, speaker, description, start_time, end_time, room } = talk;
  const operation = cb => {
    db.run(
      `UPDATE talks SET title = ?, speaker = ?, description = ?, 
       start_time = ?, end_time = ?, room = ? WHERE id = ?`,
      [title, speaker, description, start_time, end_time, room, id],
      cb
    );
  };

  retryOperation(operation)
    .then(() => callback(null))
    .catch(err => callback(err));
};

const deleteTalk = (id, callback) => {
  const operation = cb => {
    db.run('DELETE FROM registrations WHERE talk_id = ?', [id], err => {
      if (err) return cb(err);
      db.run('DELETE FROM talks WHERE id = ?', [id], cb);
    });
  };

  retryOperation(operation)
    .then(() => callback(null))
    .catch(err => callback(err));
};

const createAttendee = (attendee, callback) => {
  const { name, email } = attendee;
  const operation = cb => {
    db.run('INSERT INTO attendees (name, email) VALUES (?, ?)', [name, email], function (err) {
      cb(err, { id: this.lastID });
    });
  };

  retryOperation(operation)
    .then(result => callback(null, result))
    .catch(err => callback(err));
};

const registerForTalk = (attendee_id, talk_id, callback) => {
  const operation = cb => {
    db.run(
      'INSERT INTO registrations (attendee_id, talk_id) VALUES (?, ?)',
      [attendee_id, talk_id],
      cb
    );
  };

  retryOperation(operation)
    .then(() => callback(null))
    .catch(err => callback(err));
};

const unregisterFromTalk = (attendee_id, talk_id, callback) => {
  const operation = cb => {
    db.run(
      'DELETE FROM registrations WHERE attendee_id = ? AND talk_id = ?',
      [attendee_id, talk_id],
      cb
    );
  };

  retryOperation(operation)
    .then(() => callback(null))
    .catch(err => callback(err));
};

const getAttendeeTalks = (attendee_id, callback) => {
  db.all(
    `SELECT t.* FROM talks t
     JOIN registrations r ON t.id = r.talk_id
     WHERE r.attendee_id = ?
     ORDER BY t.start_time`,
    [attendee_id],
    callback
  );
};

const getTalksWithAttendees = callback => {
  db.all(
    `SELECT 
      t.*,
      GROUP_CONCAT(a.name) as attendee_names,
      COUNT(a.id) as attendee_count
    FROM talks t
    LEFT JOIN registrations r ON t.id = r.talk_id
    LEFT JOIN attendees a ON r.attendee_id = a.id
    GROUP BY t.id
    ORDER BY t.start_time`,
    callback
  );
};

const getConferenceName = callback => {
  db.get('SELECT conference_name FROM conference_settings WHERE id = 1', callback);
};

const updateConferenceName = (name, callback) => {
  const operation = cb => {
    db.run(
      'UPDATE conference_settings SET conference_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
      [name],
      cb
    );
  };

  retryOperation(operation)
    .then(() => callback(null))
    .catch(err => callback(err));
};

const getAllAttendees = callback => {
  db.all(
    `SELECT a.*, 
            COUNT(r.talk_id) as registered_talks_count
     FROM attendees a
     LEFT JOIN registrations r ON a.id = r.attendee_id
     GROUP BY a.id
     ORDER BY a.created_at DESC`,
    callback
  );
};

const deleteAttendee = (attendee_id, callback) => {
  const operation = cb => {
    db.serialize(() => {
      // First delete all registrations for this attendee
      db.run('DELETE FROM registrations WHERE attendee_id = ?', [attendee_id], err => {
        if (err) return cb(err);
        // Then delete the attendee
        db.run('DELETE FROM attendees WHERE id = ?', [attendee_id], cb);
      });
    });
  };

  retryOperation(operation)
    .then(() => callback(null))
    .catch(err => callback(err));
};

module.exports = {
  init,
  getAllTalks,
  createTalk,
  updateTalk,
  deleteTalk,
  createAttendee,
  registerForTalk,
  unregisterFromTalk,
  getAttendeeTalks,
  getTalksWithAttendees,
  getConferenceName,
  updateConferenceName,
  getAllAttendees,
  deleteAttendee
};
