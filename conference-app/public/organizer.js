document.addEventListener('DOMContentLoaded', function() {
    const addForm = document.getElementById('addTalkForm');
    const editForm = document.getElementById('editTalkForm');
    const modal = document.getElementById('editModal');
    const closeBtn = document.querySelector('.close');
    
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(addForm);
        const data = Object.fromEntries(formData);
        
        try {
            const response = await fetch('/api/talks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                location.reload();
            } else {
                alert('Failed to add talk');
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });
    
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const talkId = this.dataset.id;
            const talkItem = document.querySelector(`.talk-item[data-id="${talkId}"]`);
            
            document.getElementById('edit-id').value = talkId;
            document.getElementById('edit-title').value = talkItem.querySelector('h3').textContent;
            document.getElementById('edit-speaker').value = talkItem.querySelector('.speaker').textContent.replace('Speaker: ', '');
            document.getElementById('edit-description').value = talkItem.querySelector('.description').textContent;
            
            const scheduleText = talkItem.querySelector('.schedule-info').textContent;
            const timeMatch = scheduleText.match(/⏰\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
            const roomMatch = scheduleText.match(/📍\s*(.+)/);
            
            if (timeMatch) {
                document.getElementById('edit-start_time').value = timeMatch[1];
                document.getElementById('edit-end_time').value = timeMatch[2];
            }
            if (roomMatch) {
                document.getElementById('edit-room').value = roomMatch[1].trim();
            }
            
            modal.style.display = 'block';
        });
    });
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
            if (!confirm('Are you sure you want to delete this talk?')) {
                return;
            }
            
            const talkId = this.dataset.id;
            
            try {
                const response = await fetch(`/api/talks/${talkId}`, {
                    method: 'DELETE'
                });
                
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to delete talk');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        });
    });
    
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const talkId = document.getElementById('edit-id').value;
        const formData = new FormData(editForm);
        const data = Object.fromEntries(formData);
        
        try {
            const response = await fetch(`/api/talks/${talkId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            if (response.ok) {
                location.reload();
            } else {
                alert('Failed to update talk');
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });
    
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});