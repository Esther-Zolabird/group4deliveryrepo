(function(){
  const socket = io();
  const userId = document.body.getAttribute('data-user-id');
  const role = document.body.getAttribute('data-role');
  socket.emit('join', { userId, role });

  socket.on('delivery:update', (payload) => {
    toast(`Delivery #${payload.id} is now ${payload.status}`);
  });
  socket.on('assign:update', ({ riderId, deliveryIds }) => {
    toast(`Assigned ${deliveryIds.length} deliveries to rider #${riderId}`);
  });
  socket.on('delivery:delay', ({ deliveryId, riderId, reason }) => {
    toast(`Delay on #${deliveryId}: ${reason}`);
  });

  function toast(message){
    const cont = document.getElementById('toast-container');
    if (!cont) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    cont.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }
})();
