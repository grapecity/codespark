let express = require('express'),
    utils = require('../utils'),
    logger = utils.winston.appLogger,
    router = express.Router(),
    UserRepository = require('../repositories/userRepository');

router.get('/', (req, res) => {
    res.render('dashboard/index', {});
});

module.exports = router;