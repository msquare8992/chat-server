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

let configPath = 'config';
if (process.env.NODE_ENV !== 'production') {
    configPath = 'config-dev';
    dotenv.config({path: '.env.development'});
}

const usersFilePath = path.join(__dirname, configPath, 'users.json');
const msgFilePath = path.join(__dirname, configPath, 'messages.json');
const activeUsersFilePath = path.join(__dirname, configPath, 'activeUsers.json');

let users = readFiles(usersFilePath, []);
let messages = readFiles(msgFilePath, []);
let activeUsers = readFiles(activeUsersFilePath, []);

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
        return res.status(400).json({ message: 'The username is already in use. Please try another one.' });
    }

    users?.push({ id: generateUniqueId(), socketId: '', username, password, secret });
    console.log("users ::: ", users, username, password, secret);
    writeFiles(usersFilePath, users);
    return res.status(201).json({ message: 'Account created successfully! You can now log in.' });
});

app.post('/login', (req, res) => {
    const { username, password, secret } = req.body;
    const user = users?.find(user => user?.username === username && user?.password === password && user?.secret === secret);

    if(!user) {
        res.status(401).json({ message: 'Invalid username or password. Please try again.' });
    }

    const token = jwt.sign({ username: user?.username }, user?.secret, { expiresIn: '7d' });
    return res.status(201).json({ message: 'You have logged in successfully', userInfo: {
        id: user?.id, socketId: user?.socketId, username: user?.username, secret: user?.secret, token
    } });
});

app.get('/auth', (req, res) => {
    const secret = req.query.secret;
    const token = req.headers['authorization'];

    if(!token) {
        return res.status(401).json({ message: 'Authentication token missing. Please log in again.' });
    }

    jwt.verify(token, secret, (err, user) => {
        if(err) {
            return res.status(401).json({ message: 'Invalid authentication token. Please sign in to continue.' });
        }

        return res.status(201).json({ message: 'Authentication successful.', username: user?.username });
    });
});

app.get('/users', (req, res) => {
    const secret = req.query.secret;
    const token = req.headers['authorization'];
    if(!token) {
        return res.status(401).json({ message: 'Authentication token missing. Please log in again.' });
    }

    jwt.verify(token, secret, (err, user) => {
        if(err) {
            return res.status(401).json({ message: 'Invalid authentication token. Please sign in to continue.' });
        }

        const userList = activeUsers?.filter(from => from?.username !== user?.username)?.map(user => ({ username: user?.username, status: user?.status, time: user?.time }));
        return res.status(201).json({ message: 'Authentication successful.', users: userList ?? [] });
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
        updateActiveUser(socket.id, username, true);
        console.log(`User registered: ${username} with scoket id: ${socket.id}`);
    });

    socket.on('getUserStatus', (data) => {
        getUserStatus(data?.from, data?.to);
        getUserStatus(data?.to, data?.from);
    });

    socket.on('getAllMessages', (data) => {
        sendAllMessages(data?.from, data?.to, 'allMessages');
        console.log(`All messages sent to ${data?.from}`);
    });

    socket.on('sendMessage', (data) => {
        const { from, to, message } = data;
        const msg = {from, to, message, time: new Date().getTime()};
        writeFiles(msgFilePath, messages.push(msg));
        sendMessage(data?.from, msg, 'receiveMessage');
        sendMessage(data?.to, msg, 'receiveMessage');
        console.log(`Message sent from ${from} to ${to}`);
    });

    socket.on('deleteAllMessages', (data) => {
        messages = messages.filter(message => !(message.from === data?.from && message.to === data?.to));
        writeFiles(msgFilePath, messages);
        sendAllMessages(data?.from, data?.to, 'receiveMessage');
        sendAllMessages(data?.to, data?.from, 'receiveMessage');
        console.log(`All messages deleted between ${data?.from} and ${data?.to}`);
    });
    
    socket.on('offer', (data) => {
        console.log("offer received: ", data);
        const activeUser = getActiveUser(null, data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('offer', data?.offer);
        }
    });

    socket.on('answer', (data) => {
        console.log("answer received: ", data);
        const activeUser = getActiveUser(null, data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('answer', data?.answer);
        }
    });

    socket.on('ice-candidate', (data) => {
        console.log("ice-candidate received: ", data);
        const activeUser = getActiveUser(null, data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('ice-candidate', data?.candidate);
        }
    });

    socket.on('disconnect', () => {
        const activeUser = getActiveUser(socket?.id, null);
        if(activeUser?.socketId && activeUser?.username) {
            updateActiveUser(activeUser?.socketId, activeUser?.username, false);
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

function writeFiles(filePath, response) {
    fs.writeFileSync(filePath, JSON.stringify(response, null, 2), 'utf8');
}

function generateUniqueId() {
    const time = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${time}-${random}`;
}

function getActiveUser(socketId, username) {
    return activeUsers.find(user => user?.socketId === socketId || user?.username === username) ?? {};
}

function getActiveUserIndex(socketId, username) {
    return activeUsers.findIndex(user => user?.socketId === socketId || user?.username === username);
}

function updateActiveUser(socketId, username, isActive) {
    const index = getActiveUserIndex(socketId, username);
    const userDetails = {socketId, username, status: isActive, time: new Date().getTime()};

    if(index > -1) {
        activeUsers[index] = userDetails;
    }
    else {
        activeUsers.push(userDetails);
    }
    writeFiles(activeUsersFilePath, activeUsers);
}

function getUserStatus(from, to) {
    const fromUser = getActiveUser(null, from);
    if (fromUser?.socketId && fromUser?.username) {
        io.to(fromUser?.socketId).emit('userStatus', getActiveUser(null, to));
    }
}

function sendMessage(name, msg, label) {
    const activeUser = getActiveUser(null, name);
    if (activeUser?.socketId && activeUser?.username) {
        io.to(activeUser?.socketId).emit(label, msg);
    }
}

function sendAllMessages(from, to, label) {
    const allMessages = messages?.filter(message => ((message.from === from && message.to === to) || (message.from === to && message.to === from)));
    sendMessage(from, allMessages, label);
}