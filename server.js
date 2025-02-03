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
const activeUsersFilePath = path.join(__dirname, 'activeUsers.json');

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
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
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
        const activeFromUser = getActiveUser(null, data?.sender);
        const activeToUser = getActiveUser(null, data?.receiver);

        if(activeFromUser?.socketId && activeFromUser?.username) {
            io.to(activeFromUser?.socketId).emit('userStatus', activeToUser);
        }

        if(activeToUser?.socketId && activeToUser?.username) {
            io.to(activeToUser?.socketId).emit('userStatus', activeFromUser);
        }
    });

    socket.on('getAllMessages', (data) => {
        const activeUser = getActiveUser(null, data?.sender);
        const filteredMessages = messages?.filter(message => message.sender === data?.sender || message.receiver === data?.sender);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('allMessages', filteredMessages);
        }
        console.log(`All messages sent to ${data?.sender}`);
    });

    socket.on('sendMessage', (data) => {
        const { sender, receiver, message } = data;
        const newMessage = {sender, receiver, message, time: new Date().getTime()};
        messages.push(newMessage);

        fs.writeFileSync(msgFilePath, JSON.stringify(messages, null, 2), 'utf8');

        const activeFromUser = getActiveUser(null, data?.sender);
        const activeToUser = getActiveUser(null, data?.receiver);
        [activeFromUser, activeToUser].forEach(activeUser => {
            if(activeUser?.socketId && activeUser?.username) {
                io.to(activeUser?.socketId).emit('receiveMessage', newMessage);
            }
        });
        console.log(`Message sent from ${sender} to ${receiver}`);
    });

    socket.on('deleteAllMessages', (data) => {
        const { sender, receiver } = data;
        messages = messages.filter(message => message.sender !== sender && message.sender !== receiver);
        fs.writeFileSync(msgFilePath, JSON.stringify(messages, null, 2), 'utf8');
        
        const activeFromUser = getActiveUser(null, data?.sender);
        const activeToUser = getActiveUser(null, data?.receiver);
        [activeFromUser, activeToUser].forEach(activeUser => {
            if(activeUser?.socketId && activeUser?.username) {
                io.to(activeUser?.socketId).emit('allMessages', []);
            }
        });
        console.log(`All messages deleted between ${sender} and ${receiver}`);
    });
    
    socket.on('offer', (data) => {
        console.log("offer received: ", data);
        const activeUser = getActiveUser(null, data?.receiver);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('offer', data?.offer);
        }
    });

    socket.on('answer', (data) => {
        console.log("answer received: ", data);
        const activeUser = getActiveUser(null, data?.receiver);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('answer', data?.answer);
        }
    });

    socket.on('ice-candidate', (data) => {
        console.log("ice-candidate received: ", data);
        const activeUser = getActiveUser(null, data?.receiver);
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
    console.log("readFiles ::: ", filePath);
    try {
        if(fs.existsSync(filePath)) {
            console.log("readFiles exists");
            const data = fs.readFileSync(filePath, 'utf8');
            return data ? JSON.parse(data) : emptyResponse;
        }
    } catch(err) {
        console.log("readFiles ::: error ::: ", err);
    }
    console.log("readFiles not exists");
    return emptyResponse;
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

    fs.writeFileSync(activeUsersFilePath, JSON.stringify(activeUsers, null, 2), 'utf8');
}