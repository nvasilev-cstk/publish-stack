const contentstack = require('@contentstack/management');
const { STACK_API_KEY, MANAGEMENT_TOKEN, HOST } = require('./config');

const client = contentstack.client({ host: HOST });
const stack = client.stack({ api_key: STACK_API_KEY, management_token: MANAGEMENT_TOKEN });

module.exports = { stack };
