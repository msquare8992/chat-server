const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const { time } = require('console');
if (process.env.NODE_ENV !== 'production') {
    const envFil = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
    dotenv.config({path: envFil});
}

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
    cors: {
        origin: process.env.CORS_ORIGIN,
        methods: ['GET', 'POST'],
        allowedHeaders: ['content-type'],
        credentials: true
    }
});

app.use(cors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type'],
    credentials: true
}));

app.get('/', (req, res) => {
  res.send('Welcome to Chat App Server');
});

let userList = {};
let messages = [];
const msgFilePath = path.join(__dirname, 'messages.json');

if(fs.existsSync(msgFilePath)) {
    const data = fs.readFileSync(msgFilePath, 'utf8');
    if(data) {
        messages = JSON.parse(data);
    }
}

io.on('connection', (socket) => {
    socket.on('offer', (data) => {
        console.log("offer received: ", data);
        const { sender, receiver, offer } = data;
        io.to(userList[receiver]).emit('offer', offer);
    });

    socket.on('answer', (data) => {
        console.log("answer received: ", data);
        const { sender, receiver, answer } = data;
        io.to(userList[receiver]).emit('answer', answer);
    });

    socket.on('ice-candidate', (data) => {
        console.log("ice-candidate received: ", data);
        const { sender, receiver, candidate } = data;
        io.to(userList[receiver]).emit('ice-candidate', candidate);
    });

    socket.on('register', (username) => {
        userList[username] = socket.id;
        console.log(`User registered: ${username} with scoket id: ${socket.id}`);
    });

    socket.on('getUserStatus', (data) => {
        const { sender, receiver } = data;
        if(userList[sender] && userList[receiver]) {
            const isSenderActive = {username: sender, status: userList[sender] ? true : false};
            const isReceiverActive = {username: receiver, status: userList[receiver] ? true : false};
            io.to(userList[sender]).emit('userStatus', isReceiverActive);
            io.to(userList[receiver]).emit('userStatus', isSenderActive);
        }
    });

    socket.on('getAllMessages', (data) => {
        const { sender, receiver } = data;
        const filteredMessages = messages?.filter(message => message.sender === sender || message.receiver === sender);
        io.to(userList[sender]).emit('allMessages', filteredMessages);
        console.log(`All messages sent to ${sender}`);
    });

    socket.on('sendMessage', (data) => {
        const { sender, receiver, message } = data;
        const newMessage = {sender, receiver, message, time: new Date().toLocaleString()};
        messages.push(newMessage);

        fs.writeFileSync(msgFilePath, JSON.stringify(messages, null, 2), 'utf8');

        if(userList[receiver]) {
            io.to(userList[sender]).emit('receiveMessage', newMessage);
            io.to(userList[receiver]).emit('receiveMessage', newMessage);
        }
        else {
            io.to(userList[sender]).emit('receiveMessage', newMessage);
        }
        console.log(`Message sent from ${sender} to ${receiver}`);
        console.log(`Message sent from ${userList[sender]} to ${userList[receiver]}`);
    });

    socket.on('deleteAllMessages', (data) => {
        const { sender, receiver } = data;
        messages = messages.filter(message => message.sender !== sender && message.sender !== receiver);
        fs.writeFileSync(msgFilePath, JSON.stringify(messages, null, 2), 'utf8');
        io.to(userList[sender]).emit('allMessages', []);
        io.to(userList[receiver]).emit('allMessages', []);
        console.log(`All messages deleted between ${sender} and ${receiver}`);
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