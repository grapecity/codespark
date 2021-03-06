process.env.NODE_ENV = process.env.NODE_ENV || 'development';

let path = require('path'),
    express = require('express'),
    morgan = require('morgan'),
    moment = require('moment'),
    // helmet = require('helmet'),
    // compression = require('compression'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    RateLimit = require('express-rate-limit'),
    RateRedisStore = require('rate-limit-redis'),
    session = require('express-session'),
    SessionRedisStore = require('connect-redis')(session),
    redisCache = require('./utils/redisCache'),
    utils = require('./utils'),
    mongoose = utils.mongoose,
    redis = utils.redis,
    winston = utils.winston,
    stream = winston.stream,
    logger = winston.appLogger,
    app = express(),
    config = new utils.Configure(),
    resMgr = new utils.ResourceManager();

resMgr.add('config', config, () => config.close());
config.setup('mongo', {
    uri: `${process.env.MONGO_PORT_27017_TCP_ADDR || '127.0.0.1'}:${process.env.MONGO_PORT_27017_TCP_PORT || '27017'}/codespark`,
    options: {},
    debug: (process.env.NODE_ENV === 'development')
});
config.setup('redis', {
    host: process.env.REDIS_PORT_6379_TCP_ADDR || '127.0.0.1',
    port: process.env.REDIS_PORT_6379_TCP_PORT || '6379',
    password: process.env.REDIS_PASSWORD || ''
});
config.setup('session', {
    maxAge: 1000 * 60 * 60 * 24, //86400000, one day
    key: "sessionId",
    secret: "cs-session-secret-DSVyhDLOQUE3UGSsDRhuvDjVEO62VbFAsQeKsxLMK61GqoRTNt9b5OOFWgM5QNSE",
    secure: false,
    httpOnly: true,
    sessionCollection: "sessions"
});
config.setup('adAuth', {
    host: "10.32.1.160",
    port: 5000,
    path: "/api/auth"
});

// database connection
mongoose.setup(config.mongo, resMgr);
redis.setup(config.redis, resMgr);
redisCache.setup(redis.client());

moment.locale('zh-cn');

// use view engine: ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Showing stack errors
app.set('showStackError', true);
app.set('trust proxy', true);


// Logging with Morgan and winston(https://github.com/expressjs/morgan) format
// for morgan can specify one of 'combined', 'common', 'dev', 'short', 'tiny'
app.use(morgan('combined', {
    stream: stream
}));

// app.use(compression());
// app.use(helmet());
app.disable('x-powered-by');

app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/fonts', express.static(path.join(__dirname, 'public/fonts')));
app.use('/img', express.static(path.join(__dirname, 'public/img')));
app.use('/video', express.static(path.join(__dirname, 'public/video')));


// Request body parsing middleware should be above methodOverride
app.use(bodyParser.urlencoded({limit: '2mb', extended: true}));
app.use(bodyParser.json({limit: '2mb'}));

// Add the cookie parser and flash middleware
app.use(cookieParser());


// Setup session
sessionStorage = new SessionRedisStore({
    client: redis.client()
});
if (!sessionStorage) {
    let MemoryStore = session.MemoryStore;
    sessionStorage = new MemoryStore();
    logger.warn('Fallback : Using MemoryStore for the Session.');
}
app.use(session({
    saveUninitialized: true,
    resave: true,
    secret: config.session.secret,
    store: sessionStorage,
    key: config.session.key,
    cookie: {
        httpOnly: config.session.httpOnly,
        domain: config.session.domain,
        maxAge: config.session.maxAge,
        secure: config.session.secure
    }
}));



// include models
require('../common/models');

// setup passport
require('./utils/passport')(app);

// setup auth
require('./utils/auth').setup(app, config.adAuth);

// setup server ui router
require('./routers')(app, config);

//  apply to all accounts requests
let apiLimit = new RateLimit({
    windowMs: 60 * 1000, // 1 minutes
    max: 60, // limit each IP to 100 requests per windowMs
    delayMs: 0, // disable delaying - full speed until the max limit is reached
    store: new RateRedisStore({
        client: redis.client()
    }),
    message: "当前IP尝试访问API次数过多，请1分钟后重试"
});
app.use(apiLimit);

// setup server api router
require('./sapi')(app);


// catch 404 and forward to error handler
app.use((req, res, next) => {
    let err = new Error(`Not Found: ${req.url}`);
    err.status = 404;
    next(err);
});

app.use((err, req, res, next) => {
    // If the error object doesn't exists
    if (!err) {
        return next();
    }
    if(req.url.slice(-4) === '.map'){
        return res.status(404).end();
    }

    err.status = err.status || 500;
    err.message = err.message || 'Something unknown error happened!';
    res.locals.title = 'Error';
    res.locals.message = err.message;
    res.locals.error = app.get('env') === 'development' ? err : {};

    // Log it
    logger.error('Error: ' + err.stack);

    res.status(err.status).render(`error/${err.status}`);
});

// bootstrap http server
let httpServer = app.listen(process.env.PORT || 5000, function () {
    logger.info('\n================================================\n' +
        'Service run successful at ' + (new Date()).toLocaleString() + '\n' +
        'Http Port   : ' + (process.env.PORT || 5000) + '\n' +
        'Mongo       : ' + config.mongo.uri + '\n' +
        'Redis       : ' + config.redis.host + ':' + config.redis.port + '\n' +
        '================================================');
});

httpServer.on('close', () => {
    if (app._closed) {
        return;
    }
    logger.info('Clean up all managed resources');
    resMgr.close();
    app._closed = true;
});

let trackedConnections = [];
httpServer.on('connection', (conn) => {
    conn.on('close', () => {
        trackedConnections.splice(trackedConnections.indexOf(conn));
    });
    trackedConnections.push(conn);
    if (trackedConnections.length > 100) {
        logger.warn(`Server concurrent connections includes to ${trackedConnections.length}`);
    } else if (trackedConnections.length > 1000) {
        logger.error(`Server concurrent connections includes to ${trackedConnections.length}`);
    }
});

process.on('exit', () => {
    if (!app._closed) {
        logger.warn('The http server is not shutdown gracefully');
        httpServer.close();
    }
});

function prcessEndHandler() {
    console.log("Process event received, now will terminate server gracefully");
    while (trackedConnections.length > 0) {
        console.log(`there are ${trackedConnections.length} active connection remained`);
        trackedConnections.pop().destroy();
    }
    console.log("All connections are closed, request http server shutdown");
    httpServer.close(err => {
        if (err) {
            logger.error('Something wrong: ' + err);
            process.exit(1);
        } else {
            logger.info('\n================================================\n' +
                'Service is now stopped\n' +
                '================================================');
            process.exit(0);
        }
    });
}
// posix, for linux, unix etc.
process.on('SIGINT', prcessEndHandler);
// window, use CTRL+BREAK to gracefully shutdown
process.on('SIGBREAK', prcessEndHandler);
// force kill
process.on('SIGTERM', prcessEndHandler);