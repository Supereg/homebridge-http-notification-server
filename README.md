# homebridge-http-notification-server

`homebridge-http-notification-server` can be used together with [Homebridge](https://github.com/nfarina/homebridge) 
http accessories. Http accessories are Homebridge plugins, which forward HomeKit requests to another program over a 
http request. An example for such an accessory would be my 
[homebridge-http-switch](https://github.com/Supereg/homebridge-http-switch).

The problem with such accessories is when 
the state of the external program changes it cannot be directly reflected in HomeKit. So one solution would be that 
every http accessory packs it's own http server to receive state changes. But with multiple switches this becomes a mess 
very fast.

This is where the `homebridge-http-notification-server` comes in. It is basically a Homebridge plugin, which is loaded by 
Homebridge like any other plugin but doesn't register any accessories or platforms. Instead it starts ONE http or https 
server. Http accessories can register with an unique id. Any request the external program will send to the notification 
server will be forwarded to the accessory which specified the respective `notificationID`.

## Installation

`sudo npm install -g homebridge-http-notification-server`

## Configuration

The configuration file is located in the homebridge directory and needs to be called `notification-server.json`

Example:
```json
{
    "hostname": "127.0.0.1",
    "port": 8080,

    "ssl": {
        "privateKey": "/path/to/private-key.prm",
        "certificate": "/path/to/certificate.cert"
    }
}
```

* `hostname` is optional, default value is `0.0.0.0`
* `port` is required, default value is `8080`
* `ssl` is optional. When specified notification-server will create an https server with the specified `privateKey` and 
`certificate`. Otherwise a default unsecured http server is started.

## How to implement 'homebridge-http-notification-server' into your project

### Implementation in the homebridge accessory (receiver)

First of all you need to specify a handler function in your homebridge accessory. `homebridge-http-notification-server` 
locates it's registration function in the `notificationRegistration` property of the homebridge api at start.

In order to be sure, that `homebridge-http-notification-server` was already loaded by homebridge, you listen on the event 
`didFinishLaunching` of the homebridge api.

`notificationRegistration(notificationId, handlerFunction[, password])`
notificationRegistration function has three parameters, the first two are required.
* `notificationId`: this is id needs to be unique per homebridge instance. It is later used to identify the accessory when 
a request is made to the notification-server
* `handlerFunction`: function which is called when the notification-server received a request for the specified `notificationId`.
It needs to have one parameter, which is the json body from the http request.
* `password`: this parameter is fully optional. If specified every request to the notification-server must be authenticated 
with the specified password. Later more on how a request is constructed.


Example http accessory:
```javascript
let api;

module.exports = function (homebridgeAPI) {
    api = homebridgeAPI;

    homebridgeAPI.registerAccessory("homebridge-http-example-accessory", "HTTP-ACCESSORY", HTTP_ACCESSORY);
};

function HTTP_ACCESSORY(log, config) {
    // Some initialization
    this.name = config.name;
    
    this.service = new Service.Switch(this.name);
    this.service.getCharacteristic(Characteristic.On)
            .on("get", this.getStatus.bind(this))
            .on("set", this.setStatus.bind(this));

    api.on('didFinishLaunching', function() {
        // check if notificationRegistration is set, if not 'notificationRegistration' is probably not installed on the system
        if (api.notificationRegistration && typeof api.notificationRegistration === "function") {
            try {
                api.notificationRegistration("accessory-identifier", this.handleNotification.bind(this), "top-secret-password");
            } catch (error) {
                // notificationID is already taken
            }
        }
    }.bind(this));
}

HTTP_ACCESSORY.prototype = {
    
    identify: function (callback) {
        this.log("Identify requested!");
        callback();
    },

    getServices: function () {
        return [this.service];
    },
    
    handleNotification: function (jsonRequest) {
        const service = jsonRequest.service; // value is optional and only relevant if your accessory exposes multiple services
        
        const characteristic = jsonRequest.characteristic;
        const value = jsonRequest.value;
        
        let characteristicType;
        switch (characteristic) {
            case "On":
                characteristicType = Characteristic.On;
                break;
            default:
                this.log("Encountered unknown characteristic when handling notification: " + jsonRequest.characteristic);
                return;
        }

        this.service.setCharacteristic(characteristicType, value);
    },
    
    getStatus: function(callback) {
      // http request
    },
    
    setStatus: function(on, callback) {
      // http request
    }
    
};
```

### Implementation in the http application (sender)

The http application sends a request to the notification-server (inside of homebridge) to update a value of a HomeKit 
characteristic. The http request must be a `POST` request. The url would be constructed as follows:

`http://<hostname>:<port>/<notificationID>?password=<password>` (`https://...` if ssl is turned on; if no password was set 
you don't specify the `password` parameter)

In our example the url would look like the following:
`http://127.0.0.1:8080/accessory-identifier?password=top-secret-password`

The POST body would look like the following:
```json
{
    "service": "switch-service",
    "characteristic": "On",
    "value": true
}
```
* `service` is fully optional. It is only useful if your accessory exposes multiple services. But if you specify it, it 
must be a string.
* `characteristic` is required. It represents the name of the characteristic which is going to be updated. Value must be 
a string. Of course this only works with characteristics which have notify permissions in the HAP specifications. 
* `value` is required. 

## Some compatible http accessories

* [homebridge-http-switch](https://github.com/Supereg/homebridge-http-switch)
* [homebridge-http-humidity-sensor](https://github.com/Supereg/homebridge-http-humidity-sensor)
* [homebridge-http-temperature-sensor](https://github.com/Supereg/homebridge-http-temperature-sensor)

_Notify me if you want to see your project here._