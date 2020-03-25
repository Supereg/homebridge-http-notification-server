const init = require("..");

const api = new FakeAPI();
init(api);
api.notificationRegistration("testID", body => {
    console.log(body);
}, "passwd");

function FakeUser() {
    this.storagePath = () => {
        return __dirname;
    }
}

function FakeAPI() {
    this.user = new FakeUser();
}

