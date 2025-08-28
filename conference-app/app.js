const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

db.init().then(() => {
  console.log('Database initialized');
}).catch(err => {
  console.error('Error initializing database:', err);
  process.exit(1);
});

app.get('/', (req, res) => {
  db.getConferenceName((err, settings) => {
    const conferenceName = settings ? settings.conference_name : 'Conference App';
    res.render('index', { conferenceName });
  });
});

app.get('/organizer', (req, res) => {
  db.getAllTalks((err, talks) => {
    if (err) {
      return res.status(500).send('Error loading talks');
    }
    db.getConferenceName((err, settings) => {
      const conferenceName = settings ? settings.conference_name : 'Conference App';
      res.render('organizer', { talks, conferenceName });
    });
  });
});

app.post('/api/talks', (req, res) => {
  const { title, speaker, description, start_time, end_time, room } = req.body;
  
  db.createTalk({ title, speaker, description, start_time, end_time, room }, (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to create talk' });
    }
    res.json({ success: true, id: result.id });
  });
});

app.put('/api/talks/:id', (req, res) => {
  const { id } = req.params;
  const { title, speaker, description, start_time, end_time, room } = req.body;
  
  db.updateTalk(id, { title, speaker, description, start_time, end_time, room }, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to update talk' });
    }
    res.json({ success: true });
  });
});

app.delete('/api/talks/:id', (req, res) => {
  const { id } = req.params;
  
  db.deleteTalk(id, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to delete talk' });
    }
    res.json({ success: true });
  });
});

app.get('/attendee', (req, res) => {
  db.getAllTalks((err, talks) => {
    if (err) {
      return res.status(500).send('Error loading talks');
    }
    db.getConferenceName((err, settings) => {
      const conferenceName = settings ? settings.conference_name : 'Conference App';
      res.render('attendee', { talks, conferenceName });
    });
  });
});

app.post('/api/attendees', (req, res) => {
  const { name, email } = req.body;
  
  db.createAttendee({ name, email }, (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to register attendee' });
    }
    res.json({ success: true, id: result.id });
  });
});

app.post('/api/registrations', (req, res) => {
  const { attendee_id, talk_id } = req.body;
  
  db.registerForTalk(attendee_id, talk_id, (err) => {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Already registered for this talk' });
      }
      return res.status(500).json({ error: 'Failed to register for talk' });
    }
    res.json({ success: true });
  });
});

app.delete('/api/registrations', (req, res) => {
  const { attendee_id, talk_id } = req.body;
  
  db.unregisterFromTalk(attendee_id, talk_id, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to unregister from talk' });
    }
    res.json({ success: true });
  });
});

app.get('/api/attendees/:id/talks', (req, res) => {
  const { id } = req.params;
  
  db.getAttendeeTalks(id, (err, talks) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get registered talks' });
    }
    res.json(talks);
  });
});

app.get('/schedule', (req, res) => {
  db.getTalksWithAttendees((err, talks) => {
    if (err) {
      return res.status(500).send('Error loading schedule');
    }
    db.getConferenceName((err, settings) => {
      const conferenceName = settings ? settings.conference_name : 'Conference App';
      res.render('schedule', { talks, conferenceName });
    });
  });
});

app.get('/api/conference-name', (req, res) => {
  db.getConferenceName((err, settings) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get conference name' });
    }
    res.json({ name: settings ? settings.conference_name : 'Conference App' });
  });
});

app.put('/api/conference-name', (req, res) => {
  const { name } = req.body;
  
  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Conference name is required' });
  }
  
  db.updateConferenceName(name.trim(), (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to update conference name' });
    }
    res.json({ success: true, name: name.trim() });
  });
});

app.listen(PORT, () => {
  console.log(`Conference app running on http://localhost:${PORT}`);
});