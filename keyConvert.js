const fs = require('fs');
const key = fs.readFileSync('./civicconnet-firebase-adminsdk-fbsvc-9c71a80474.json', 'utf8')
const base64 = Buffer.from(key).toString('base64')
console.log(base64)