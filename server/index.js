const https = require("https"),
    fs = require("fs");

const accounts = require('./accounts');
const projects = require('./projects');

const options = {
    key: fs.readFileSync("./privatekey.pem"),
    cert: fs.readFileSync("./certificate.pem")
};

const PORT = 50_001;

/**
 * All function take
        url: string[] - array of parts of the URL. 
            e.g. path/to/something passed as ['path', 'to', 'something']
            e.g. ['get-id']
        req: any - the node request
        res: any - the node response
        data: object - the JSON passed through
 */
const handlers = {
    // Debug
    'ping': (m, req, res, body) => res.end('{"ok": "true"}'),
    'log': (url, req, res, body) => console.log(body),
    
    // accounts
    'delete-account': accounts.delete,
    'new-user': accounts.newUser,
    'change-user': accounts.changeData,
    'get-id': accounts.id,
    'username-exists': accounts.usernameExists,
    'get-username': accounts.username,
    'get-details': accounts.details,
    
    // projects
    'new-project': projects.createProject,
    'delete-project': projects.deleteProject,
    'get-project-names': projects.getUserProjectNames,
    'save-project': projects.save,
    'get-project-access': projects.accessLevel,
    'get-project-editors': projects.getProjectEditors,
    'get-project-name': projects.getName,
    'share-project': projects.share,
    'get-assets': projects.getAssets,
    'build-project': projects.build,
    'delete-asset': projects.deleteAsset,
    'has-been-built': projects.beenBuilt,
    'contributor-info': projects.contributorInfo,
    'latest-contributor': projects.latestContributor,
    'all-contributions': projects.allContributors,
};

const rawPaths = [
    'upload-asset',
];

async function serverResponse (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "https://entropyengine.dev");
    const url = req.url.split('/');
    // expecting url of something like /api/987678,
    // so url[0] should be empty, and url[1] should be the actual path

    if (url[0] !== '' || !handlers.hasOwnProperty(url[1])) {
        // no handler can be found
        console.log(`ERROR: no handler '${url[1]}' for url '${req.url}'`);
        res.end('{}');
        res.writeHead(200);
        return;
    }

    if (rawPaths.includes(url[1])){
        url.shift();
        const handler = handlers[url[0]];
        handler(url, req, res);
        return;
    }


    let data = '';
    // need to get the data one packet at a time, and then deal with the whole lot at once
    req.on('data', chunk => {
        data += chunk;
    });
    
    req.on('end', () => {
        // the POST body has fully come through, continue on now

        res.writeHead(200);

        let body = {};
        try {
            body = JSON.parse(data ?? '{}');
        } catch (E) {}


        // so that the url now starts at index 0 from now on
        url.shift();

        const handler = handlers[url[0]];
        
        handler(url, req, res, body);
    });
}

https.createServer(options, serverResponse).listen(PORT, () => {
    console.log(`Server started on port ` + PORT);
});