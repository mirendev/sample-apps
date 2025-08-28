// Fun conference name generator
const prefixes = [
  'Mega',
  'Ultra',
  'Hyper',
  'Quantum',
  'Cosmic',
  'Turbo',
  'Ninja',
  'Rocket',
  'Lightning',
  'Thunder'
];
const middles = ['Code', 'Tech', 'Dev', 'Hack', 'Data', 'Cloud', 'Web', 'Stack', 'Byte', 'Pixel'];
const suffixes = [
  'Con',
  'Fest',
  'Summit',
  'Palooza',
  'Jam',
  'Conf',
  'Expo',
  'Symposium',
  'Gathering',
  'Fiesta'
];
const years = ['2024', '3000', 'Infinity', 'Forever', 'Extreme', 'Ultimate'];

function generateConferenceName() {
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const middle = middles[Math.floor(Math.random() * middles.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const year = years[Math.floor(Math.random() * years.length)];

  return `${prefix} ${middle} ${suffix} ${year}`;
}

// Loading messages
const loadingMessages = [
  '🚀 Preparing the stage...',
  '🎭 Gathering the speakers...',
  '☕ Brewing fresh coffee...',
  '🎪 Setting up the circus tent...',
  '🌈 Adding rainbow sprinkles...',
  '🦄 Summoning unicorns...',
  '🎯 Aligning the satellites...',
  '🍕 Ordering pizza for everyone...',
  '🎸 Tuning the guitars...',
  '🎨 Painting the venue...'
];

function getRandomLoadingMessage() {
  return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
}

// Confetti effect
function createConfetti() {
  const colors = [
    '#f44336',
    '#e91e63',
    '#9c27b0',
    '#673ab7',
    '#3f51b5',
    '#2196f3',
    '#03a9f4',
    '#00bcd4',
    '#009688',
    '#4caf50',
    '#8bc34a',
    '#cddc39',
    '#ffeb3b',
    '#ffc107',
    '#ff9800',
    '#ff5722'
  ];

  for (let i = 0; i < 100; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 3 + 's';
    confetti.style.animationDuration = Math.random() * 3 + 2 + 's';
    document.body.appendChild(confetti);

    setTimeout(() => confetti.remove(), 5000);
  }
}

// Easter egg: Konami code
let konamiCode = [];
const konamiPattern = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a'
];

document.addEventListener('keydown', e => {
  konamiCode.push(e.key);
  konamiCode = konamiCode.slice(-10);

  if (konamiCode.join(',') === konamiPattern.join(',')) {
    activatePartyMode();
    konamiCode = [];
  }
});

function activatePartyMode() {
  document.body.classList.add('party-mode');
  createConfetti();

  const message = document.createElement('div');
  message.className = 'party-message';
  message.innerHTML = '🎉 PARTY MODE ACTIVATED! 🎉';
  document.body.appendChild(message);

  setTimeout(() => {
    message.remove();
    document.body.classList.remove('party-mode');
  }, 5000);
}

// Talk reactions
const reactions = ['👍', '❤️', '🎉', '🔥', '⭐', '🚀', '🤯', '💡'];

function addReactionButtons() {
  const talkCards = document.querySelectorAll('.talk-card, .talk-item');

  talkCards.forEach(card => {
    if (card.querySelector('.reaction-bar')) return;

    const reactionBar = document.createElement('div');
    reactionBar.className = 'reaction-bar';

    reactions.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'reaction-btn';
      btn.innerHTML = emoji;
      btn.onclick = function () {
        animateReaction(this, emoji);
      };
      reactionBar.appendChild(btn);
    });

    card.appendChild(reactionBar);
  });
}

function animateReaction(button, emoji) {
  const floater = document.createElement('div');
  floater.className = 'reaction-float';
  floater.innerHTML = emoji;
  floater.style.left = button.offsetLeft + 'px';
  floater.style.top = button.offsetTop + 'px';
  button.parentElement.appendChild(floater);

  button.classList.add('reaction-bounce');

  setTimeout(() => {
    floater.remove();
    button.classList.remove('reaction-bounce');
  }, 1000);
}

// Fun hover effects for buttons
document.addEventListener('DOMContentLoaded', () => {
  const buttons = document.querySelectorAll('.button');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'rotate(' + (Math.random() * 6 - 3) + 'deg) scale(1.05)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'rotate(0deg) scale(1)';
    });
  });
});

// Export functions for use in other scripts
window.funUtils = {
  generateConferenceName,
  getRandomLoadingMessage,
  createConfetti,
  activatePartyMode,
  addReactionButtons
};
