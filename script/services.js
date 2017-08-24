var socket = io();

var configuration = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};

var peerConnections = {}; //map of {socketId: socket.io id, RTCPeerConnection}
var remoteViewContainer = document.getElementById("remoteViewContainer");
let localStream = null;
let friends = null; //list of {socketId, displayName}
let me = null; //{socketId, displayName}

function join(roomId, displayName, callback) {
    socket.emit("join-server", {roomId, displayName}, function (friendsList) {
        friends = friendsList;
        console.log('Joins', friends);
        friends.forEach((friend) => {
            createPeerConnection(friend, true);
        });
        if (callback !== null) {
            me = {
                socketId: socket.id,
                displayName: displayName
            };
            callback();
        }
    });
}

function createPeerConnection(friend, isOffer) {
    let socketId = friend.socketId;
    let retVal = new RTCPeerConnection(configuration);

    peerConnections[socketId] = retVal;

    retVal.onicecandidate = function (event) {
        console.log('onicecandidate', event);
        if (event.candidate) {
            socket.emit("exchange-server", {'to': socketId, 'candidate': event.candidate});
        }
    };

    function createOffer() {
        retVal.createOffer(function (desc) {
            console.log('createOffer', desc);
            retVal.setLocalDescription(desc, function () {
                console.log('setLocalDescription', retVal.localDescription);
                socket.emit("exchange-server", {'to': socketId, 'sdp': retVal.localDescription});
            }, logError);
        }, logError);
    }

    retVal.onnegotiationneeded = function () {
        console.log('onnegotiationneeded');
        if (isOffer) {
            createOffer();
        }
    };

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
        if (window.onFriendCallback !== null) {
            window.onFriendCallback(socketId, event.stream);
        }
    };

    retVal.ondatachannel = function (event) {
        console.log('ondatachannel', event);
        createDataChannel(isOffer, event);
    };

    retVal.addStream(localStream);

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
            if (window.onDataChannelMessage !== null) {
                window.onDataChannelMessage(JSON.parse(event.data));
            }
        };

        dataChannel.onopen = function () {
            console.log('dataChannel.onopen');
        };

        dataChannel.onclose = function () {
            console.log("dataChannel.onclose");
        };

        retVal.textDataChannel = dataChannel;
    }

    return retVal;
}

function exchange(data) {
    let fromId = data.from;
    let pc;
    if (fromId in peerConnections) {
        pc = peerConnections[fromId];
    } else {
        let friend = friends.filter((friend) => friend.socketId == fromId)[0];
        if (friend === null) {
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
                        socket.emit("exchange-server", {'to': fromId, 'sdp': pc.localDescription});
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
    if (peerConnections.hasOwnProperty(socketId)) {
        let pc = peerConnections[socketId];
        pc.close();
        delete peerConnections[socketId];

        if (window.onFriendLeft) {
            window.onFriendLeft(socketId);
        }
    }
}

socket.on("connect", function (data) {
    console.log('connect');
    getRoomList((data) => {
    });
});

socket.on("exchange-client", function (data) {
    exchange(data);
});

socket.on("leave-client", function (participant) {
    leave(participant.socketId);
});

socket.on("join-client", function (friend) {
    //new friend:
    friends.push(friend);
    console.log("New friend joint conversation: ", friend);
});

socket.on("newroom-client", function (room) {
    console.log("New room: ", room);
    //@nhancv TODO: do with new room

});

function logError(error) {
    console.log("logError", error);
}

//------------------------------------------------------------------------------
// Services
function getRoomList(callback) {
    socket.emit("list-server", {}, (data) => {
        console.log("Get list: ", data);
        callback(data);
    });
}

function countFriends(roomId, callback) {
    socket.emit("count-server", roomId, (count) => {
        console.log("Count friends result: ", count);
        callback(count);
    });
}

function loadLocalStream(muted) {
    navigator.getUserMedia({"audio": true, "video": true}, function (stream) {
        localStream = stream;
        let selfView = document.getElementById("selfView");
        selfView.src = URL.createObjectURL(stream);
        selfView.muted = muted;
    }, logError);
}

function broadcastMessage(message) {
    for (let key in peerConnections) {
        let pc = peerConnections[key];
        pc.textDataChannel.send(JSON.stringify(message));
    }
}


socket.on("template-client", function (data) {
    console.log(data);
});

function getTemplate() {
    console.log("getTemplate");
    let request = {
        action: 'get',
        template: {
            id: 1,
            roomId: VIDEO_CONFERENCE_ROOM,
            config: {
                background: null
            }
        }
    };
    socket.emit("template-server", request, (error) => {
        console.log(error);
    });
}

function putTemplate() {
    console.log("putTemplate");
    let request = {
        action: 'put',
        template: {
            id: 1,
            roomId: VIDEO_CONFERENCE_ROOM,
            config: {
                background: null
            }
        }
    };
    socket.emit("template-server", request, (error) => {
        console.log(error);
    });
}