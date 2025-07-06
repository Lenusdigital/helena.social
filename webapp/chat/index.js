const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const wss = new WebSocket.Server({ port: 3001 });
console.log("[Server] WebSocket server running on ws://0.0.0.0:3001");

const userProfiles = new Map();

wss.on("connection", (ws) => {
    ws.id = uuidv4();
    ws.nickname = `Guest-${ws.id.substring(0, 5)}`;
    ws.profileImage = "";
    userProfiles.set(ws.id, {
        nickname: ws.nickname,
        profileImage: ws.profileImage
    });

    console.log(`[Server] Client connected: ${ws.id}`);

    ws.send(JSON.stringify({
        type: "welcome",
        clientId: ws.id
    }));

    sendUserList(ws);

    ws.on("message", (message) => {
        try {
            // Protect before parsing
            const MAX_MESSAGE_SIZE = 2_000_000; // 2 MB
            if (message.length > MAX_MESSAGE_SIZE) {
                console.warn(`[Server] Dropping oversized raw message from ${ws.id}: ${message.length} bytes`);
                return;
            }

            const str = message.toString("utf8");
            const data = JSON.parse(str);

            console.log(`[Server] Message from ${ws.id}:`, data);

            /* Security check */
            const allowedTypes = new Set(['ping', 'set-nickname', 'text', 'image']);
            if (!allowedTypes.has(data.type)) {
                console.warn(`[Server] Invalid message type from ${ws.id}:`, data.type);
                return;
            }

            if (data.type === 'text' && typeof data.message === 'string' && data.message.length > 2000) {
                console.warn(`[Server] Dropping oversized text message from ${ws.id}`);
                return;
            }

            if (data.type === 'image' && typeof data.imageData === 'string' && data.imageData.length > 2_000_000) {
                console.warn(`[Server] Dropping oversized image from ${ws.id}`);
                return;
            }

            if (data.type === "ping") {
                ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
                return;
            }


            if (data.type === "set-nickname") {
                ws.nickname = data.nickname || ws.nickname;

                if (data.profileImage && !data.profileImage.startsWith("data:") && !data.profileImage.startsWith("/static/")) {
                    ws.profileImage = `/static/draw/images/icons/${data.profileImage}`;
                } else {
                    ws.profileImage = data.profileImage || "";
                }


                userProfiles.set(ws.id, {
                    nickname: ws.nickname,
                    profileImage: ws.profileImage
                });

                const profileMsg = {
                    type: "profile-update",
                    clientId: ws.id,
                    nickname: ws.nickname,
                    profileImage: ws.profileImage,
                    timestamp: Date.now()
                };

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(profileMsg));
                    }
                });

                const joinMsg = {
                    type: "system",
                    message: `${ws.nickname} joined the chat`,
                    timestamp: Date.now()
                };

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(joinMsg));
                    }
                });

                broadcastUserList();
                return;
            }



            // if (data.type === "set-nickname") {
            //     ws.nickname = data.nickname || ws.nickname;
            //     ws.profileImage = data.profileImage || "";

            //     userProfiles.set(ws.id, {
            //         nickname: ws.nickname,
            //         profileImage: ws.profileImage
            //     });

            //     const profileMsg = {
            //         type: "profile-update",
            //         clientId: ws.id,
            //         nickname: ws.nickname,
            //         profileImage: ws.profileImage,
            //         timestamp: Date.now()
            //     };

            //     wss.clients.forEach((client) => {
            //         if (client.readyState === WebSocket.OPEN) {
            //             client.send(JSON.stringify(profileMsg));
            //         }
            //     });

            //     const joinMsg = {
            //         type: "system",
            //         message: `${ws.nickname} joined the chat`,
            //         timestamp: Date.now()
            //     };

            //     wss.clients.forEach((client) => {
            //         if (client.readyState === WebSocket.OPEN) {
            //             client.send(JSON.stringify(joinMsg));
            //         }
            //     });

            //     broadcastUserList();
            //     return;
            // }

            if (data.type === "text") {
                const broadcastData = {
                    type: "text",
                    clientId: ws.id,
                    message: data.message,
                    timestamp: Date.now()
                };

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && client !== ws) {
                        client.send(JSON.stringify(broadcastData));
                    }
                });

                return;
            }

            if (data.type === "image") {
                const broadcastData = {
                    type: "image",
                    clientId: ws.id,
                    nickname: ws.nickname,
                    profileImage: ws.profileImage,
                    imageData: data.imageData,
                    imageName: data.imageName || "Artwork",
                    timestamp: Date.now()
                };

                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN && client !== ws) {
                        client.send(JSON.stringify(broadcastData));
                    }
                });

                return;
            }

        } catch (err) {
            console.error("[Server] Failed to parse message:", err);
        }
    });

    ws.on("close", () => {
        console.log(`[Server] Client disconnected: ${ws.id}`);

        userProfiles.delete(ws.id);

        const leaveMsg = {
            type: "system",
            message: `${ws.nickname} left the chat`,
            timestamp: Date.now()
        };

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(leaveMsg));
            }
        });

        broadcastUserList();
    });
});

function sendUserList(ws) {
    const fullUserList = [];
    userProfiles.forEach((profile, id) => {
        fullUserList.push({
            clientId: id,
            nickname: profile.nickname,
            profileImage: profile.profileImage
        });
    });

    ws.send(JSON.stringify({
        type: "user-list",
        users: fullUserList,
        timestamp: Date.now()
    }));
}

function broadcastUserList() {
    const fullUserList = [];
    userProfiles.forEach((profile, id) => {
        fullUserList.push({
            clientId: id,
            nickname: profile.nickname,
            profileImage: profile.profileImage
        });
    });

    const msg = JSON.stringify({
        type: "user-list",
        users: fullUserList,
        timestamp: Date.now()
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}
