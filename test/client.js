const request = require("request");

const body ={
    service: "Switch",
    characteristic: "On",
    value: "true",
    password: "passwd",
};


request(
    {
        url: "http://127.0.0.1:8080/testID",
        body: JSON.stringify(body, null, 4),
        method: "POST",
        rejectUnauthorized: false
    },
    (error, response, body) => {
        if (error)
            console.log(error);
        else {
            console.log("response: " + response.statusCode);
            console.log("body: '" + body + "'");
            // TODO wrong password / missing password => expects error code
            // TODO body expected
        }
    }
);
