const cors = require('cors');
const http = require('http');

const express = require('express');
const socketIo = require('socket.io');

const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');
const bodyParser = require('body-parser');


const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { exec } = require('child_process');

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
    const { username, password } = req.body;
    const userExists = users?.some(user => user?.username === username);

    if(userExists) {
        return res.status(400).json({ message: 'The username is already in use. Please try another one.' });
    }

    users?.push({ id: generateUniqueId('user-'), socketId: '', username, password });
    writeFiles(usersFilePath, users);
    updateActiveUser('', username, false, '');
    return res.status(201).json({ message: 'Account created successfully! You can now log in.' });
});

app.post('/login', (req, res) => {
    const { username, password, secret } = req.body;
    
    const user = users?.find(user => {
        if(user?.username === username) {
            const bytes = CryptoJS.AES.decrypt(user?.password, secret);
            const decryptedPassword = bytes.toString(CryptoJS.enc.Utf8);
            if(decryptedPassword === password) {
                return user;
            }
        }
    });

    if(!user) {
        return res.status(401).json({ message: 'Invalid username or password. Please try again.' });
    }

    updateActiveUser('', user?.username, false, '');
    const token = jwt.sign({ username: user?.username }, secret , { expiresIn: '7d' });
    return res.status(201).json({ message: 'You have logged in successfully', userInfo: {
        id: user?.id, username: user?.username, token
    } });
});

app.get('/auth', (req, res) => {
    const token = req.headers['authorization'];

    if(!token) {
        return res.status(401).json({ message: 'Authentication token missing. Please log in again.' });
    }

    jwt.verify(token, req.query.secret, (err, user) => {
        if(err) {
            return res.status(401).json({ message: 'Invalid authentication token. Please sign in to continue.' });
        }

        return res.status(201).json({ message: 'Authentication successful.', username: user?.username });
    });
});

app.get('/users', (req, res) => {
    const token = req.headers['authorization'];
    if(!token) {
        return res.status(401).json({ message: 'Authentication token missing. Please log in again.' });
    }

    jwt.verify(token, req.query.secret, (err, user) => {
        if(err) {
            return res.status(401).json({ message: 'Invalid authentication token. Please sign in to continue.' });
        }

        return res.status(201).json({ message: 'Authentication successful.', users: activeUsers ?? [] });
    });
});

app.post('/syncActiveUsers', (req, res) => {
    const token = req.headers['authorization'];
    if(!token) {
        return res.status(401).json({ message: 'Authentication token missing. Please log in again.' });
    }

    jwt.verify(token, req.query.secret, (err, user) => {
        if(err) {
            return res.status(401).json({ message: 'Invalid authentication token. Please sign in to continue.' });
        }

        let localActiveUsers = req.body.activeUsers || [];
        activeUsers = [...localActiveUsers, ...activeUsers?.filter(au => !localActiveUsers?.some(lau => lau?.username === au?.username))];
        writeFiles(activeUsersFilePath, activeUsers);
        return res.status(201).json({ message: 'active user updated', isUpdated: true });
    });
});

app.post('/syncMessages', (req, res) => {
    const token = req.headers['authorization'];
    if(!token) {
        return res.status(401).json({ message: 'Authentication token missing. Please log in again.' });
    }

    jwt.verify(token, req.query.secret, (err, user) => {
        if(err) {
            return res.status(401).json({ message: 'Invalid authentication token. Please sign in to continue.' });
        }

        let localMessges = req.body.messages || [];
        localMessges = messages?.length > 0 ? localMessges?.filter(localMsg => !messages?.some(msg => msg?.id === localMsg?.id)) : localMessges;
        messages = [...messages, ...localMessges];
        writeFiles(msgFilePath, messages);
        return res.status(201).json({ message: 'messages updated', isUpdated: true });
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
        updateActiveUser(socket.id, username, true, new Date().getTime());
    });

    socket.on('getUserStatus', (data) => {
        getUserStatus(data?.from, data?.to);
        getUserStatus(data?.to, data?.from);
    });

    socket.on('getAllMessages', (data) => {
        sendAllMessages(data?.from, data?.to, 'allMessages');
    });

    socket.on('sendMessage', (data) => {
        const { from, to, message } = data;
        const msg = { from, to, message, time: new Date().getTime(), id: generateUniqueId('messgae-') };
        messages.push(msg);
        writeFiles(msgFilePath, messages);
        sendMessage(data?.from, msg, 'receiveMessage');
        sendMessage(data?.to, msg, 'receiveMessage');
    });

    socket.on('editMessage', (data) => {
        const { from, to, message, time } = data;
        const msgIndex = messages?.filter(msg => msg.from === from && msg.to === to && msg.time === time);
        if(msgIndex > -1) {
            messages[msgIndex].message = message;
            sendMessage(data?.from, {data, isEdited: true}, 'messageEdited');
            sendMessage(data?.to, {data, isEdited: true}, 'messageEdited');
        }
        else {
            sendMessage(data?.from, {data, isEdited: false}, 'messageEdited');
        }
    });

    socket.on('deleteMessage', (data) => {
        const { from, to, time } = data;
        const msgIndex = messages?.filter(msg => msg.from === from && msg.to === to && msg.time === time);
        if(msgIndex > -1) {
            messages?.splice(msgIndex, 1);
            sendMessage(data?.from, {data, isDeleted: true}, 'messageDeleted');
            sendMessage(data?.to, {data, isDeleted: true}, 'messageDeleted');
        }
        else {
            sendMessage(data?.from, {data, isDeleted: true}, 'messageDeleted');
        }
    });

    socket.on('deleteAllMessages', (data) => {
        messages = messages.filter(message => !(message.from === data?.from && message.to === data?.to));
        writeFiles(msgFilePath, messages);
        sendAllMessages(data?.from, data?.to, 'deletedAllMessages');
        sendAllMessages(data?.to, data?.from, 'deletedAllMessages');
    });

    socket.on('typing', (data) => {
        const activeUser = getActiveUser(data?.to);
        io.to(activeUser?.socketId).emit('typing', data);
    });
    
    socket.on('callRequest', (data) => {
        const activeUser = getActiveUser(data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('callRequest', data);
        }
    });
    
    socket.on('callAccept', (data) => {
        const activeUser = getActiveUser(data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('callAccept', data);
        }
    });
    
    socket.on('offer', (data) => {
        const activeUser = getActiveUser(data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('offer', data?.offer);
        }
    });

    socket.on('answer', (data) => {
        const activeUser = getActiveUser(data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('answer', data?.answer);
        }
    });

    socket.on('ice-candidate', (data) => {
        const activeUser = getActiveUser(data?.to);
        if(activeUser?.socketId && activeUser?.username) {
            io.to(activeUser?.socketId).emit('ice-candidate', data?.candidate);
        }
    });

    socket.on('closeVideoCall', (data) => {
        sendMessage(data?.from, data, 'closeVideoCall');
        sendMessage(data?.to, data, 'closeVideoCall');
    });

    socket.on('disconnect', () => {
        if(socket?.id) {
            getActiveUserBySocketId()
            const activeUser = getActiveUserBySocketId(socket?.id);
            if(activeUser?.socketId && activeUser?.username) {
                updateActiveUser('', activeUser?.username, false, new Date().getTime());
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

function writeFiles(filePath, response) {
    fs.writeFileSync(filePath, JSON.stringify(response, null, 2), 'utf8');
}

function generateUniqueId(prefix) {
    const time = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}${time}-${random}`;
}

function getActiveUser(username) {
    return activeUsers.find(user => user?.username === username) ?? {};
}

function getActiveUserIndex(username) {
    return activeUsers.findIndex(user => user?.username === username);
}

function getActiveUserBySocketId(socketId) {
    return activeUsers.find(user => user?.socketId === socketId) ?? {};
}

function updateActiveUser(socketId, username, isActive, time) {
    const index = getActiveUserIndex(username);
    const userDetails = { socketId, username, status: isActive, time };

    if(index > -1) {
        activeUsers[index] = userDetails;
    }
    else {
        activeUsers.push(userDetails);
    }
    writeFiles(activeUsersFilePath, activeUsers);
}

function getUserStatus(from, to) {
    const fromUser = getActiveUser(from);
    if (fromUser?.socketId && fromUser?.username) {
        io.to(fromUser?.socketId).emit('userStatus', getActiveUser(to));
    }
}

function sendMessage(name, msg, label) {
    const activeUser = getActiveUser(name);
    if (activeUser?.socketId && activeUser?.username) {
        io.to(activeUser?.socketId).emit(label, msg);
    }
}

function sendAllMessages(from, to, label) {
    const allMessages = messages?.filter(message => ((message.from === from && message.to === to) || (message.from === to && message.to === from)));
    sendMessage(from, allMessages, label);
}