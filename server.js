const cors = require('cors');
const http = require('http');

const express = require('express');
const socketIo = require('socket.io');

const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');


const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const app = express();
const server = http.createServer(app);

if (process.env.NODE_ENV !== 'production') {
    dotenv.config({path: '.env.development'});
}

const usersFilePath = path.join(__dirname, 'users.json');
const msgFilePath = path.join(__dirname, 'messages.json');
const statusFilePath = path.join(__dirname, 'status.json');

let users = readFiles(usersFilePath, []);
let messages = readFiles(msgFilePath, []);
let userStatus = readFiles(statusFilePath, {});

let userList = {};

app.use(bodyParser.json());
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type', 'Authorization'],
    credentials: true
}));

app.get('/', (req, res) => {
  res.send('Welcome to Chat App Server');
});

app.post('/register', (req, res) => {
    const { username, password, secret } = req.body;
    const userExists = users?.some(user => user?.username === username);

    if(userExists) {
        return res.status(400).json({ message: 'User already exists' });
    }

    users?.push({ username, password, secret });
    console.log("users ::: ", users, username, password, secret);
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
    return res.status(201).json({ message: 'User registered successfully' });
});

app.post('/login', (req, res) => {
    const { username, password, secret } = req.body;
    const user = users?.find(user => user?.username === username && user?.password === password && user?.secret === secret);

    if(!user) {
        res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ username: user?.username }, user?.secret, { expiresIn: '1h' });
    return res.status(201).json({ token, message: 'User login successfully' });
});

app.get('/auth', (req, res) => {
    const secret = req.query.secret;
    const token = req.headers['authorization'];

    if(!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    jwt.verify(token, secret, (err, user) => {
        if(err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        return res.status(201).json({ message: 'valid token', username: user?.username });
    });
});

const io = socketIo(server, {
    cors: {
        origin: process.env.CORS_ORIGIN,
        methods: ['GET', 'POST'],
        allowedHeaders: ['content-type', 'Authorization'],
        credentials: true
    }
});

io.on('connection', (socket) => {
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

function readFiles(filePath, emptyResponse) {
    try {
        if(fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return data ? JSON.parse(data) : emptyResponse;
        }
    } catch(err) {
        console.log("readFiles ::: error ::: ", err);
    }
    return emptyResponse;
}

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