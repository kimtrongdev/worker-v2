function createWorkersConfig(GROUPS) {
  return [
    {
      email: 'test1@gmail.com',
      startUrl: 'https://labs.google/fx/vi/tools/flow',
      cookieString: '__Host-next-auth.csrf-token=%7C84927e3a9d98a7a2ef42469aa5c554bdc15032b508b642b8174f40b52d0b7ebe; __Secure-next-auth.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..LxyhkJLJb8fZnZK7.v288syUgGG4j6UJ5shB42iqWfxP9lGakKFOS6ZwFiKoP4YQa5zNM7ftvfvV_4NsfWkimwNwLC1UNYcVo6eVUdFZ5SMV0Gsofr9CLhDPssrzrqIlf-iUxUwyPHK62RqTz7cszXEinTKpKxY788TLBMwtBUd_9BuvAgYSHs7mXhbdQV6X778655; EMAIL=%22hoakakakak%40gmail.com%22; _ga=GA1.1.290739334.1773651965',
      cookieUrl: 'https://labs.google/fx/vi/tools/flow',
      enabled: true,
      onDemand: false,
      idleTimeout: 60000,
      groups: [
        GROUPS.RECAPTCHA_VEO3,
        GROUPS.VEO3_TOKEN,
      ],
    },
  ];
}

module.exports = createWorkersConfig;
