const DRAW_ROOM = "draw";

var socket = null;
var configuration = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};

var peerConnections = {}; //map of {socketId: socket.io id, RTCPeerConnection}
var remoteViewContainer = document.getElementById("remoteViewContainer");
let localStream = null;
let friends = []; //list of {socketId, displayName}
let me = null; //{socketId, displayName}

function createPeerConnection(friend, isOffer) {
    let socketId = friend.socketId;
    console.log("Creating peer connection to: ", socketId);
    var retVal = new RTCPeerConnection(configuration);

    peerConnections[socketId] = retVal;

    retVal.onicecandidate = function (event) {
        console.log('onicecandidate', event);
        if (event.candidate) {
            socket.emit('exchange-server', {'to': socketId, 'candidate': event.candidate});
        }
    };

    function createOffer() {
        retVal.createOffer(function (desc) {
            console.log('createOffer', desc);
            retVal.setLocalDescription(desc, function () {
                console.log('setLocalDescription', retVal.localDescription);
                socket.emit('exchange-server', {'to': socketId, 'sdp': retVal.localDescription});
            }, logError);
        }, logError);
    }

    retVal.onnegotiationneeded = function () {
        console.log('onnegotiationneeded');
        if (isOffer) {
            createOffer();
        }
    }

    retVal.oniceconnectionstatechange = function (event) {
        console.log('oniceconnectionstatechange', event);
        if (event.target.iceConnectionState === 'connected' && isOffer) {
            createDataChannel(isOffer, null);
        }
    };

    retVal.onsignalingstatechange = function (event) {
        console.log('onsignalingstatechange', event);
    };

    retVal.onaddstream = function (event) {
        console.log('onaddstream', event);
        if (window.onFriendCallback != null) {
            window.onFriendCallback(socketId, event.stream);
        }
    };

    retVal.ondatachannel = function (event) {
        console.log('ondatachannel', event);
        $("#connect-to-peers").hide();
        createDataChannel(isOffer, event);
    };

    if (localStream != null) {
        retVal.addStream(localStream);
    }

    function createDataChannel(isOffer, _event) {
        if (retVal.textDataChannel) {
            return;
        }
        var dataChannel = null;
        if(isOffer){
            dataChannel = retVal.createDataChannel("text");
        }else{
            dataChannel = _event.channel;
        }

        dataChannel.onerror = function (error) {
            console.log("dataChannel.onerror", error);
        };

        dataChannel.onmessage = function (event) {
            console.log("dataChannel.onmessage:", event.data);
            try {
                let point = JSON.parse(event.data);
                drawPoint(point);
            } catch (e) {
                console.log("Invalid point data: ", event.data);
            }
        };

        dataChannel.onopen = function (event) {
            console.log('dataChannel.onopen: ', event);
        };

        dataChannel.onclose = function () {
            console.log("dataChannel.onclose");
        };

        retVal.textDataChannel = dataChannel;
    }

    return retVal;
}

function exchange(data) {
    var fromId = data.from;
    var pc;
    if (fromId in peerConnections) {
        pc = peerConnections[fromId];
    } else {
        let friend = friends.filter((friend) => friend.socketId == fromId)[0];
        if (friend == null) {
            friend = {
                socketId: fromId,
                displayName: ""
            }
        }
        pc = createPeerConnection(friend, false);
    }

    if (data.sdp) {
        console.log('exchange sdp', data);
        pc.setRemoteDescription(new RTCSessionDescription(data.sdp), function () {
            if (pc.remoteDescription.type == "offer")
                pc.createAnswer(function (desc) {
                    console.log('createAnswer', desc);
                    pc.setLocalDescription(desc, function () {
                        console.log('setLocalDescription', pc.localDescription);
                        socket.emit('exchange-server', {'to': fromId, 'sdp': pc.localDescription});
                    }, logError);
                }, logError);
        }, logError);
    } else {
        console.log('exchange candidate', data);
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
}

function leave(socketId) {
    console.log('leave', socketId);
    var pc = peerConnections[socketId];
    pc.close();
    delete peerConnections[socketId];
    if (window.onFriendLeft) {
        window.onFriendLeft(socketId);
    }
}

function logError(error) {
    console.log("logError", error);
}

//------------------------------------------------------------------------------
// Services
function connectToServer() {

    socket = io({'force new connection': true});

    socket.on('exchange-client', function (data) {
        exchange(data);
    });

    socket.on('disconnect', function () {
        socket = null;
        $("#connect-to-server").show();
        $("#disconnect").hide();
        console.log("Disconnected");
    });

    socket.on('connect', function (data) {
        console.log('connect');
        $("#connect-to-server").hide();
        $("#disconnect").show();
        $("#connect-to-peers").show();

        socket.emit('join-server', {roomId: DRAW_ROOM, displayName: ""}, function (result) {
            friends = result;
            console.log('Friends', friends);
        });
    });

    socket.on("join-client", function (friend) {
        //new friend:
        friends.push(friend);
        console.log("New friend joint conversation: ", friend);
    });
}

function disconnect() {
    socket.disconnect();
}

function loadLocalStream(muted) {
    navigator.getUserMedia({"audio": true, "video": true}, function (stream) {
        localStream = stream;
    }, logError);
}

function broadcastMessage(message) {
    console.log("broadcastMessage: ", message);
    for (let key in peerConnections) {
        let pc = peerConnections[key];
        pc.textDataChannel.send(JSON.stringify(message));
    }
}

function connectToPeers() {
    friends.forEach((friend) => {
        createPeerConnection(friend, true);
    })
}

loadLocalStream();


function drawPoint(point) {
    var c = document.getElementById("myCanvas");
    var ctx = c.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.arc(point.x, point.y, 1, 0, 2 * Math.PI, true);
    ctx.strokeStyle = '#00F';
    ctx.stroke();
}

let drawing = false;

function onMouseClick(event) {
    drawing = true;
    let point = {
        x: event.offsetX,
        y: event.offsetY
    };
    broadcastMessage(point);
    drawPoint(point);
}

function onMouseUp(event) {
    drawing = false;
}

function onMouseOut(event) {
    drawing = false;
}

function onMouseMove(event) {
    if (drawing) {
        let point = {
            x: event.offsetX,
            y: event.offsetY
        };
        broadcastMessage(point);
        drawPoint(point);
    }
}
