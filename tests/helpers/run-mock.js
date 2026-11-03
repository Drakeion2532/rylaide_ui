// Copyright (c) 2026 Shubhan Punde · https://github.com/Drakeion2532/rylaide_ui · All rights reserved · sp2532-ce395384fbda
const { startMockUpstream } = require('./mock-upstream');
startMockUpstream().then((u) => { console.log(u.base); });
