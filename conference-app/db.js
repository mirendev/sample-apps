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
      db.run(`
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
      `, (err) => {
        if (err) return reject(err);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS attendees (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          attendee_id INTEGER NOT NULL,
          talk_id INTEGER NOT NULL,
          registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (attendee_id) REFERENCES attendees(id),
          FOREIGN KEY (talk_id) REFERENCES talks(id),
          UNIQUE(attendee_id, talk_id)
        )
      `, (err) => {
        if (err) return reject(err);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS conference_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          conference_name TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);
      });

      db.get("SELECT COUNT(*) as count FROM talks", (err, row) => {
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
            stmt.run(talk.title, talk.speaker, talk.description, 
                    talk.start_time, talk.end_time, talk.room);
          });

          stmt.finalize();
        }
        
        // Check if conference name exists
        db.get("SELECT COUNT(*) as count FROM conference_settings", (err, row) => {
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
            
            db.run("INSERT INTO conference_settings (id, conference_name) VALUES (1, ?)", 
              [conferenceName], (err) => {
                if (err) return reject(err);
                resolve();
              });
          } else {
            resolve();
          }
        });
      });
    });
  });
};

const getAllTalks = (callback) => {
  db.all("SELECT * FROM talks ORDER BY start_time", callback);
};

const createTalk = (talk, callback) => {
  const { title, speaker, description, start_time, end_time, room } = talk;
  db.run(
    `INSERT INTO talks (title, speaker, description, start_time, end_time, room)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [title, speaker, description, start_time, end_time, room],
    function(err) {
      callback(err, { id: this.lastID });
    }
  );
};

const updateTalk = (id, talk, callback) => {
  const { title, speaker, description, start_time, end_time, room } = talk;
  db.run(
    `UPDATE talks SET title = ?, speaker = ?, description = ?, 
     start_time = ?, end_time = ?, room = ? WHERE id = ?`,
    [title, speaker, description, start_time, end_time, room, id],
    callback
  );
};

const deleteTalk = (id, callback) => {
  db.run("DELETE FROM registrations WHERE talk_id = ?", [id], (err) => {
    if (err) return callback(err);
    db.run("DELETE FROM talks WHERE id = ?", [id], callback);
  });
};

const createAttendee = (attendee, callback) => {
  const { name, email } = attendee;
  db.run(
    "INSERT INTO attendees (name, email) VALUES (?, ?)",
    [name, email],
    function(err) {
      callback(err, { id: this.lastID });
    }
  );
};

const registerForTalk = (attendee_id, talk_id, callback) => {
  db.run(
    "INSERT INTO registrations (attendee_id, talk_id) VALUES (?, ?)",
    [attendee_id, talk_id],
    callback
  );
};

const unregisterFromTalk = (attendee_id, talk_id, callback) => {
  db.run(
    "DELETE FROM registrations WHERE attendee_id = ? AND talk_id = ?",
    [attendee_id, talk_id],
    callback
  );
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

const getTalksWithAttendees = (callback) => {
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

const getConferenceName = (callback) => {
  db.get("SELECT conference_name FROM conference_settings WHERE id = 1", callback);
};

const updateConferenceName = (name, callback) => {
  db.run(
    "UPDATE conference_settings SET conference_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1",
    [name],
    callback
  );
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
  updateConferenceName
};