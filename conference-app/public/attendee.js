let currentAttendeeId = null;
let registeredTalks = new Set();

function showQuickMessage(message) {
  const msg = document.createElement('div');
  msg.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 20px 40px;
        border-radius: 10px;
        font-size: 24px;
        z-index: 10000;
        animation: bounce 0.5s ease;
    `;
  msg.textContent = message;
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 2000);
}

document.addEventListener('DOMContentLoaded', function () {
  const registerForm = document.getElementById('registerForm');
  const talksSection = document.getElementById('talksSection');
  const myTalksSection = document.getElementById('myTalksSection');

  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const formData = new FormData(registerForm);
    const data = Object.fromEntries(formData);

    try {
      const response = await fetch('/api/attendees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (response.ok) {
        currentAttendeeId = result.id;
        document.getElementById('attendeeName').textContent = data.name;
        talksSection.style.display = 'block';
        myTalksSection.style.display = 'block';
        registerForm.style.display = 'none';
        registerForm.parentElement.querySelector('h2').textContent = '🎉 Registration Complete!';

        // Celebration time!
        funUtils.createConfetti();

        loadRegisteredTalks();
      } else {
        if (result.error && result.error.includes('UNIQUE')) {
          alert('This email is already registered. Please use a different email.');
        } else {
          alert('Failed to register: ' + result.error);
        }
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  });

  document.querySelectorAll('.register-btn').forEach(btn => {
    btn.addEventListener('click', async function () {
      if (!currentAttendeeId) {
        alert('Please register first!');
        return;
      }

      const talkId = this.dataset.talkId;
      const isRegistered = registeredTalks.has(talkId);

      try {
        const response = await fetch('/api/registrations', {
          method: isRegistered ? 'DELETE' : 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            attendee_id: currentAttendeeId,
            talk_id: talkId
          })
        });

        if (response.ok) {
          if (isRegistered) {
            registeredTalks.delete(talkId);
            this.textContent = 'Register for Talk';
            this.classList.remove('registered');
            document
              .querySelector(`.talk-card[data-talk-id="${talkId}"]`)
              .classList.remove('registered');

            // Sad message
            const sadMessages = [
              '😢 We\'ll miss you!',
              '💔 Breaking up is hard',
              '😔 Maybe next time?'
            ];
            showQuickMessage(sadMessages[Math.floor(Math.random() * sadMessages.length)]);
          } else {
            registeredTalks.add(talkId);
            this.textContent = 'Unregister';
            this.classList.add('registered');
            document
              .querySelector(`.talk-card[data-talk-id="${talkId}"]`)
              .classList.add('registered');

            // Happy message and mini confetti
            const happyMessages = [
              '🎉 Great choice!',
              '✨ You\'re gonna love it!',
              '🚀 See you there!'
            ];
            showQuickMessage(happyMessages[Math.floor(Math.random() * happyMessages.length)]);

            // Mini confetti burst
            for (let i = 0; i < 20; i++) {
              setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = this.offsetLeft + Math.random() * 100 + 'px';
                confetti.style.backgroundColor = ['#f44336', '#4caf50', '#2196f3', '#ffeb3b'][
                  Math.floor(Math.random() * 4)
                ];
                document.body.appendChild(confetti);
                setTimeout(() => confetti.remove(), 3000);
              }, i * 30);
            }
          }
          loadRegisteredTalks();
        } else {
          const result = await response.json();
          alert('Failed: ' + result.error);
        }
      } catch (error) {
        alert('Error: ' + error.message);
      }
    });
  });

  async function loadRegisteredTalks() {
    if (!currentAttendeeId) return;

    try {
      const response = await fetch(`/api/attendees/${currentAttendeeId}/talks`);
      const talks = await response.json();

      registeredTalks = new Set(talks.map(t => t.id.toString()));

      document.querySelectorAll('.register-btn').forEach(btn => {
        const talkId = btn.dataset.talkId;
        if (registeredTalks.has(talkId)) {
          btn.textContent = 'Unregister';
          btn.classList.add('registered');
          document
            .querySelector(`.talk-card[data-talk-id="${talkId}"]`)
            .classList.add('registered');
        } else {
          btn.textContent = 'Register for Talk';
          btn.classList.remove('registered');
          document
            .querySelector(`.talk-card[data-talk-id="${talkId}"]`)
            .classList.remove('registered');
        }
      });

      const registeredTalksList = document.getElementById('registeredTalksList');
      if (talks.length > 0) {
        registeredTalksList.innerHTML = talks
          .map(
            talk => `
                    <div class="talk-item">
                        <h3>${talk.title}</h3>
                        <p class="speaker">Speaker: ${talk.speaker}</p>
                        <p class="description">${talk.description}</p>
                        <p class="schedule-info">
                            <span class="time">⏰ ${talk.start_time} - ${talk.end_time}</span>
                            <span class="room">📍 ${talk.room}</span>
                        </p>
                    </div>
                `
          )
          .join('');
      } else {
        registeredTalksList.innerHTML = '<p>You haven\'t registered for any talks yet.</p>';
      }
    } catch (error) {
      console.error('Error loading registered talks:', error);
    }
  }
});
