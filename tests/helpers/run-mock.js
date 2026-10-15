const { startMockUpstream } = require('./mock-upstream');
startMockUpstream().then((u) => { console.log(u.base); });
