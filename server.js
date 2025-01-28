const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: 'https://msquare8992.github.io',
        // origin: 'http://localhost:4200',
        methods: ['GET', 'POST'],
        allowedHeaders: ['content-type'],
        credentials: true
    }
});

app.use(cors({
    origin: 'https://msquare8992.github.io',
    // origin: 'http://localhost:4200',
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type'],
    credentials: true
}));

app.get('/', (req, res) => {
  res.send('Welcome to Chat App Server');
});

let userList = {};

io.on('connection', (socket) => {
    socket.on('register', (username) => {
        userList[username] = socket.id;
        console.log(`User registered: ${username} with scoket id: ${socket.id}`);
        for(let user in userList) {
            io.emit('userStatus', {username: user, status: true});
        }
    })

    socket.on('sendMessage', (data) => {
        const { sender, receiver, message } = data;
        if(userList[receiver]) {
            io.to(userList[sender]).emit('receiveMessage', {sender, message});
            io.to(userList[receiver]).emit('receiveMessage', {sender, message});
        }
        else {
            io.to(userList[sender]).emit('receiveMessage', {sender, message});
        }
    });

    socket.on('disconnect', () => {
        for(let username in userList) {
            if(userList[username] === socket.id) {
                delete userList[username];
                io.emit('userStatus', {username, status: false});
                console.log(`${username} disconnected and removed from userList`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server is running on port', PORT);
});