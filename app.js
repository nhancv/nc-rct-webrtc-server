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
/*
roomId {
    name:
    roomImage: null
    particular: []
    token:
}
 */
var templateList = {};
/*
templateRoomId {
	id:
	config: {
		background:
	}
}
 */


//------------------------------------------------------------------------------
//  Serving static files
app.get('/', function (req, res) {
    console.log('get /');
    res.sendFile(__dirname + '/index.html');
});

app.get('/draw', function (req, res) {
    console.log('get /draw');
    res.sendFile(__dirname + '/draw.html');
});

app.get('/test', function (req, res) {
    console.log('get /testdatachannel');
    res.sendFile(__dirname + '/testdatachannel.html');
});

app.use('/style', express.static(path.join(__dirname, 'style')));
app.use('/script', express.static(path.join(__dirname, 'script')));
app.use('/image', express.static(path.join(__dirname, 'image')));

app.use('/testdatachannel', express.static(path.join(__dirname, 'testdatachannel')));

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
function findParticipant(socketId) {
    for (let roomId in roomList) {
        for (let i = 0; i < roomList[roomId].participant.length; i++) {
            if (roomList[roomId].participant[i].socketId == socketId) {
                console.log('roomList[roomId].participant[i]: ', roomList[roomId].participant[i]);
                return roomList[roomId].participant[i];
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
            roomImage: null,
            token: room.token,
            participant: []
        };

        console.log("New room: ", room);
        io.emit("newroom-client", room);
    }
}

io.on('connection', function (socket) {
    console.log('Connection: ', socket.id);

    socket.on("disconnect", function () {
        console.log('Disconnect');

        for (let roomId in roomList) {
            for (let i = 0; i < roomList[roomId].participant.length; i++) {
                if (roomList[roomId].participant[i].socketId == socket.id) {
                    io.emit("leave-client", roomList[roomId].participant[i]);
                    roomList[roomId].participant.splice(i, 1);
                    break;
                }
            }
            setTimeout(function () {
                if (roomList.hasOwnProperty(roomId) && roomList[roomId].participant.length === 0) {
                    io.emit("leaveall-client", roomId);
                    delete roomList[roomId];
                }
            }, 30000);
        }
        if (socket.room) {
            socket.leave(socket.room);
        }
    });


    /**
     * Callback: list of {socketId, displayName: name of user}
     */
    socket.on("join-server", function (joinData, callback) { //Join room
        let roomId = joinData.roomId;
        let roomImage = joinData.roomImage;
        let displayName = joinData.displayName;
        socket.join(roomId);
        socket.room = roomId;
        console.log("joinData: ", joinData);

        createNewRoom({
            id: roomId,
            name: roomId,
            roomImage: roomImage,
            token: socket.id
        });
        roomList[roomId].participant.push({
            socketId: socket.id,
            displayName: displayName
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
            io.sockets.connected[friend.socketId].emit("join-client", {
                socketId: socket.id,
                displayName: displayName
            });
        });
        io.emit("notify-client", {
            id: roomId,
            name: roomList[roomId].name,
            roomImage: null,
            participant: roomList[roomId].participant,
            token: roomList[roomId].token
        });
    });

    socket.on("exchange-server", function (data) {
        console.log('exchange', data);
        data.from = socket.id;
        var to = io.sockets.connected[data.to];
        to.emit("exchange-client", data);
    });

    socket.on("count-server", function (roomId, callback) {
        var socketIds = socketIdsInRoom(roomId);
        callback(socketIds.length);
    });

    socket.on("list-server", function (data, callback) {
        callback(roomList);
    });

    socket.on("newroom-server", function (room, error) {
        createNewRoom(room, error);
    });

    socket.on("template-server", function (request, error) {

        /*************************************************
         * request{
         *  action: 'put' or 'get'
         *  template: {
         *      id
         *      roomId
         *      config: {
         *          background:
         *          }
         *      }
         * }
         */

        try {
            let action = request.action;
            let template = request.template;
            if (action == 'put') {
                templateList[template.roomId] = template;
                io.emit("template-client", {
                    roomId: template.roomId,
                    template: template
                });
            } else if (action == 'get') {
                if (templateList.hasOwnProperty(template.roomId)) {
                    socket.emit("template-client", {
                        roomId: template.roomId,
                        template: templateList[template.roomId]
                    });
                } else {
                    if (error) error("Template not found.");
                }
            }
        } catch (e) {
            if (error) error("Error: " + e);
        }


    });

    socket.on("remove-server", function (room, callback) {
        if (roomList.hasOwnProperty(room.id)) {
            if (room.token && roomList[room.id].token == room.token) {
                delete roomList[room.id];
                callback(true, "Succeed");
            } else {
                callback(false, "Token is not found");
            }
        } else {
            callback(false, "Room is not exist");
        }

    })
});
