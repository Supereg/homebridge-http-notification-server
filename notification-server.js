const fs = require("fs");
const path = require('path');
const url = require("url");
const http = require("http");
const https = require("https");

const handlers = {};

module.exports = function(homebridgeApi) {
    homebridgeApi.notificationRegistration = notificationRegistration.bind(this);

    main(homebridgeApi);
};

/**
 * API call which is used by an accessory to listen for incoming update requests
 *
 * @param notificationID - internalID the accessory is referencing itself and which is included in the http request to identify the accessory
 * @param handlerFunction - function, which has one argument for the json body
 * @param password - <optional> if specified every http request to the notification-server needs to be authenticated with the accessory specific password
 */
function notificationRegistration(notificationID, handlerFunction, password) {
    log("'" + notificationID + "' registered for notifications " + (password?"(authenticated)":"(without authentication)"));

    if (handlers.hasOwnProperty(notificationID)) {
        throw new Error("'" + notificationID + "' is already registered");
    }

    handlers[notificationID] = {
        handler: handlerFunction,
        password: password
    };
}

/**
 * main method to start the notification server
 *
 * @param api - HomeBridge API
 */
function main(api) {
    log("Initializing Notification Server...");

    const storagePath = api.user.storagePath();
    const configPath = path.join(storagePath, "notification-server.json");

    let configuration = { //default configuration
        port: 8080
    };

    if (!fs.existsSync(configPath)) {
        log("Could not find config for notification-server (" + configPath + "). Using default configuration");
    }
    else {
        try {
            log("Parsing config file...");
            configuration = JSON.parse(fs.readFileSync(configPath));
        } catch (error) {
            logError("Could not read 'notification-server.json' config file. Maybe some malformed JSON?");
            logError("Try to validate your JSON with http://jsonlint.com");
            logError("");
            logError(error);
            logError("");
            logError("We continue with using default configuration");
        }
    }

    init(configuration);
}

/**
 * initializes the http/https server
 *
 * @param configuration - content of config file from disk
 */
function init(configuration) {
    let secure = false;
    const listenOptions = {};
    let secureOptions = {};

    if (configuration.hostname)
        listenOptions.host = configuration.hostname;

    listenOptions.port = configuration.port || 8080;
    if (typeof configuration.port !== "number") {
        listenOptions.port = 8080;
        logError("The property port in the cofiguration is not a number. Falling back to the default value.");
    }

    if (configuration.ssl && configuration.ssl.privateKey && configuration.ssl.certificate) {
        secure = true;

        let key;
        let cert;

        log("Configuring SSL...");
        try {
            key = fs.readFileSync(configuration.ssl.privateKey);
        } catch (error) {
            logError("Could not read ssl privateKey from disk, falling back to http");
            logError(error);

            secure = false;
        }

        try {
            cert = fs.readFileSync(configuration.ssl.certificate);
        } catch (error) {
            logError("Could not read ssl certificate from disk, falling back to http");
            logError(error);

            secure = false;
        }

        if (secure) {
            secureOptions = {
                key: key,
                cert: cert
            }
        }
    }

    log("Starting " +(secure? "HTTPS": "HTTP") + " server...");
    const server = secure? https.createServer(secureOptions, handleHTTPCall): http.createServer(handleHTTPCall);

    server.listen(listenOptions);
    log("Listening on " + (listenOptions.host? listenOptions.host: "0.0.0.0") + ":" + listenOptions.port);
}

/**
 * validates that the body has the required format
 * developers can add MORE field but not LESS
 *
 * body format:
 * {
 *      service: "switchOne", // <optional>: data type must be string
 *      characteristic: "On", // <required>: data type must be string
 *      value: 56 // <required>
 * }
 *
 * @param body
 */
function validateJsonBody(body) {
    if (typeof body !== "object")
        throw new Error("Json string is not an object");

    if (!(body.hasOwnProperty("characteristic") || body.hasOwnProperty("value")))
        throw new Error("Missing required property");

    if (body.hasOwnProperty("service") && typeof body.service !== "string")
        throw new Error("property 'service' has an invalid data type");

    if (typeof body.characteristic !== "string")
        throw new Error("property 'characteristic' has an invalid data type");
}

/**
 * handles every incoming http call
 *
 * @param request
 * @param response
 */
function handleHTTPCall(request, response) {
    if (request.method !== "POST") {
        response.writeHead(405, {'Content-Type': "text/html"});
        response.write("Method Not Allowed");
        response.end();

        log("Someone tried to access the server without an POST request");
        return;
    }

    const parts = url.parse(request.url, true);

    const query = parts.query;

    const pathname = parts.pathname.charAt(0) === "/"
        ? parts.pathname.substring(1)
        : parts.pathname;
    const path = pathname.split("/");

    if (path.length !== 1) {
        response.writeHead(400, {'Content-Type': "text/html"});
        response.write("Bad Request");
        response.end();

        log("Bad Request: " + parts.pathname);
    }
    else {
        const notificationID = path[0];
        const handlerObject = handlers[notificationID];

        if (handlerObject) {
            let handler = handlerObject.handler;
            let password = handlerObject.password;

            if (password && (!query.hasOwnProperty("password") || query.password !== password)) {
                response.writeHead(401, {'Content-Type': "text/html"});
                response.write("Unauthorized");
                response.end();

                log("'" + notificationID + "' tried to get access without authorization");
                return;
            }

            let body = "";
            let invalid = false;
            request.on("data", function (data) {
                body += data;

                // Too much POST data, kill the connection!
                // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
                if (body.length > 1e6) {
                    body = "";
                    invalid = true;

                    logError("'" + notificationID + "' sent POST with too large body. Destroying connection...");

                    response.writeHead(413, {'Content-Type': 'text/plain'});
                    response.write("Payload Too Large");
                    response.end();

                    request.connection.destroy();
                }
            });

            request.on("end", function () {
                if (invalid)
                    return;

                response.writeHead(200, {'Content-Type': 'text/html'});
                response.write("OK");
                response.end();

                let jsonBody;
                try {
                    jsonBody = JSON.parse(body);

                    validateJsonBody(jsonBody);
                } catch (error) {
                    response.writeHead(400, {'Content-Type': 'text/html'});
                    response.write("Bad Request");
                    response.end();

                    logError("'" + notificationID + "' sent malformed body: " + error.message);
                    return;
                }

                try {
                    handler(jsonBody);
                } catch (error) {
                    logError("Handler encountered error when parsing body:");
                    logError(error);

                    response.writeHead(500, {'Content-Type': 'text/html'});
                    response.write("Internal Server Error");
                    response.end();
                }
            });
        }
        else {
            response.writeHead(404, {'Content-Type': "text/html"});
            response.write("Not Found");
            response.end();

            log("could not find accessory '" + notificationID +"'");
        }
    }
}

/**
 * replicates basic log format from homebridge logger
 *
 * @param message - message to log
 */
function log(message) {
    const prefix = "notification-server";
    message = "[" + prefix + "] " + message;

    const date = new Date();
    message = "[" + date.toLocaleString() + "] " + message;

    console.log(message);
}

/**
 * replicates basic error format from homebridge logger
 *
 * @param message - message to log to error
 */
function logError(message) {
    const prefix = "notification-server";
    message = "[" + prefix + "] " + message;

    const date = new Date();
    message = "[" + date.toLocaleString() + "] " + message;

    console.error(message);
}