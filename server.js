const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const { time } = require('console');

if (process.env.NODE_ENV !== 'production') {
    dotenv.config({path: '.env.development'});
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
let userStatus = [];

const msgFilePath = path.join(__dirname, 'messages.json');
const statusFilePath = path.join(__dirname, 'status.json');

if(fs.existsSync(msgFilePath)) {
    const data = fs.readFileSync(msgFilePath, 'utf8');
    if(data) {
        messages = JSON.parse(data);
    }
}

if(fs.existsSync(statusFilePath)) {
    const data = fs.readFileSync(statusFilePath, 'utf8');
    if(data) {
        userStatus = JSON.parse(data);
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

    socket.on('offer-end', data => {
        console.log("offer-end received: ", data);
        const { sender, receiver } = data;
        io.to(userList[receiver]).emit('offer-end', data);
    });

    socket.on('register', (username) => {
        userList[username] = socket.id;
        updateUserStatus(username);
        console.log(`User registered: ${username} with scoket id: ${socket.id}`);
    });

    socket.on('getUserStatus', (data) => {
        const { sender, receiver } = data;
        io.to(userList[sender]).emit('userStatus', getUserStatus(receiver));
        io.to(userList[receiver]).emit('userStatus', getUserStatus(sender));
    });

    socket.on('getAllMessages', (data) => {
        const { sender, receiver } = data;
        const filteredMessages = messages?.filter(message => message.sender === sender || message.receiver === sender);
        io.to(userList[sender]).emit('allMessages', filteredMessages);
        console.log(`All messages sent to ${sender}`);
    });

    socket.on('sendMessage', (data) => {
        const { sender, receiver, message } = data;
        const newMessage = {sender, receiver, message, time: new Date().getTime()};
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
                updateUserStatus(username);
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

function getUserStatus(username) {
    const index = userStatus.findIndex(user => user?.username === username);
    return index > -1 ? userStatus[index] : {};
}

function updateUserStatus(username) {
    const status = userList[username] ? true : false;
    const statusDetails = {username, status, time: new Date().getTime()};
    const index = userStatus.findIndex(user => user?.username === username);

    if(index > -1) {
        userStatus[index] = statusDetails;
    }
    else {
        userStatus.push(statusDetails);
    }

    fs.writeFileSync(statusFilePath, JSON.stringify(userStatus, null, 2), 'utf8');
}