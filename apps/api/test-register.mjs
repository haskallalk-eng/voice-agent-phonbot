const res = await fetch('http://localhost:3001/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ orgName: 'Test GmbH', email: 'test@test.com', password: 'test1234' }),
});
console.log('Status:', res.status);
console.log('Body:', await res.json());
