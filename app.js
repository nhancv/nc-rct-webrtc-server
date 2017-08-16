var express = require('express');
var app = express();
var path = require('path');
var fs = require('fs');
var open = require('open');
var httpsOptions = {
    key: fs.readFileSync('./fake-keys/privatekey.pem'),
    cert: fs.readFileSync('./fake-keys/certificate.pem')
};
var isLocal = process.env.PORT === null;
var serverPort = (process.env.PORT || 4443);
var server = null;
if (isLocal) {
    server = require('https').createServer(httpsOptions, app);
} else {
    server = require('http').createServer(app);
}
var io = require('socket.io')(server);

var roomList = {};

//------------------------------------------------------------------------------
//  Serving static files
app.get('/', function (req, res) {
    console.log('get /');
    res.sendFile(__dirname + '/index.html');
});

app.get('/draw', function (req, res) {
    console.log('get /');
    res.sendFile(__dirname + '/draw.html');
});

app.use('/style', express.static(path.join(__dirname, 'style')));
app.use('/script', express.static(path.join(__dirname, 'script')));
app.use('/image', express.static(path.join(__dirname, 'image')));

server.listen(serverPort, function () {
    console.log('Rewebrtc-server is up and running at %s port', serverPort);
    if (isLocal) {
        open('https://localhost:' + serverPort)
    }
});

//------------------------------------------------------------------------------
//  WebRTC Signaling
function socketIdsInRoom(roomId) {
    var socketIds = io.nsps['/'].adapter.rooms[roomId];
    if (socketIds) {
        var collection = [];
        for (var key in socketIds) {
            collection.push(key);
        }
        return collection;
    } else {
        return [];
    }
}

/*************************************************
 * Find participant by socket id. Return index of array if input has roomId and resIndex = true
 */
function findParticipant(socketId, roomId, resIndex) {
    if (roomId === undefined || roomId === null) {
        for (let roomId in roomList) {
            for (let i = 0; i < roomList[roomId].participant.length; i++) {
                if (roomList[roomId].participant[i].socketId == socketId) {
                    return resIndex ? i : roomList[roomId].participant[i];
                }
            }
        }
    } else {
        for (let i = 0; i < roomList[roomId].participant.length; i++) {
            if (roomList[roomId].participant[i].socketId == socketId) {
                return resIndex ? i : roomList[roomId].participant[i];
            }
        }
    }
    return null;
}

/**
 {
     id:
     name:
     token: to detect owner
 }
 * @param room
 * @param error
 */
function createNewRoom(room, error) {
    if (roomList.hasOwnProperty(room.id)) {
        if (error) error("Room already used.");
    } else {

        roomList[room.id] = {
            name: room.name,
            token: room.token,
            participant: []
        };

        console.log("New room: ", room);
        io.emit('newroom', room);
    }
}

io.on('connection', function (socket) {
    console.log('Connection: ', socket.id);

    socket.on('disconnect', function () {
        console.log('Disconnect');

        for (let roomId in roomList) {
            for (let i = 0; i < roomList[roomId].participant.length; i++) {
                if (roomList[roomId].participant[i].socketId == socket.id) {
                    roomList[roomId].participant[i].splice(i, 1);
                    break;
                }
            }
        }

        if (socket.room) {
            var room = socket.room;
            io.to(room).emit('leave', socket.id);
            socket.leave(room);
        }
    });


    /**
     * Callback: list of {socketId, name: name of user}
     */
    socket.on('join', function (joinData, callback) { //Join room
        let roomId = joinData.roomId;
        let name = joinData.name;
        socket.join(roomId);
        socket.room = roomId;

        createNewRoom({
            id: roomId,
            name: roomId,
            token: socket.id
        });
        roomList[roomId].participant.push({
            socketId: socket.id,
            displayName: name
        });

        var socketIds = socketIdsInRoom(roomId);
        let friends = socketIds.map((socketId) => {

            let room = findParticipant(socketId);
            return {
                socketId: socketId,
                displayName: room === null ? null : room.displayName
            }
        }).filter((friend) => friend.socketId != socket.id);
        callback(friends);
        //broadcast
        friends.forEach((friend) => {
            io.sockets.connected[friend.socketId].emit("join", {
                socketId: socket.id,
                displayName: name
            });
        });
        console.log('Join: ', joinData);

    });

    socket.on('exchange', function (data) {
        console.log('exchange', data);
        data.from = socket.id;
        var to = io.sockets.connected[data.to];
        to.emit('exchange', data);
    });

    socket.on("count", function (roomId, callback) {
        var socketIds = socketIdsInRoom(roomId);
        callback(socketIds.length);
    });

    socket.on("list", function (data, callback) {
        callback(roomList);
    });

    socket.on("newroom", function (room, error) {
        createNewRoom(room, error);
    })
});
