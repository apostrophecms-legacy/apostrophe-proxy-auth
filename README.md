# apostrophe-cas

This module allows an [Apostrophe](https://apostrophenow.org) site to act as a CAS client or server.

Client support means that you can send users to a third party site that supports [CAS](http://www.jasig.org/cas) (Centralized Authentication Service) to log in, and then they will be logged into your Apostrophe site. This is known as "single sign-on."

Server support means that other sites can use your site as a CAS server. In this case your site is the authoritative one.

## Installation

npm install --save apostrophe-cas

## Configuration as a CAS Client

Add the module to the `modules` section of your `app.js` file:

```javascript
    apostrophe-cas: {
      client: {
        protocol: 'https',
        host: 'cas.myschool.edu',
      },
    }
```

Next, make sure you shut off the regular authentication system. This is a top-level option in `app.js` (that is, it's not inside "modules," it's at the same level as "modules"):

```javascript
  auth: false
```

Now your users will be redirected to the CAS login page at `https://cas.myschool.edu/cas/login` when they try to log in. After login they are directed back. Logout is also redirected.

### Alternate CAS URLs

In the `client` object above you may specify any of the fields below if needed. The defaults are shown. This is taken from the documentation of the [connect-cas](https://github.com/AceMetrix/connect-cas) module, on which the client support in `apostrophe-cas` is built.

```javascript
    protocol: 'https',
    host: undefined,
    hostname: undefined, // ex. google
    port: 443,
    paths: {
        validate: '/cas/validate',               // not implemented
        serviceValidate: '/cas/serviceValidate', // This is the one we use
        proxyValidate: '/cas/proxyValidate', // Not tested with Apostrophe
        proxy: '/cas/proxy', // Not tested with Apostrophe
        login: '/cas/login', // The user-visible login URL on the CAS server
        logout: '/cas/logout' // Ditto for logout
    }
```

## Configuration as a CAS Server

Configuring Apostrophe as a CAS server allows other sites to send users to Apostrophe to log in, and then redirects those users back to the other site, allowing that site to verify their username.

Here's the configuration to allow two sites to do this:

```javascript
    'apostrophe-cas': {
      server: {
        services: [
          'https://www.site-we-are-allowing.com/',
          'https://www.another-ok-site.com/'
        ]
      }
    }
```

The CAS login, logout and serviceValidate URLs will be `/cas/login`, `/cas/logout` and `/cas/serviceValidate`. This is not currently configurable.

For security, the client site's URL must be in the `services` list. If the client site is lazy and sends people to both "www.foo.com" and plain old "foo.com", make sure you list both in `services`.

You *may* allow users to to come from an "http:" URL, but you really shouldn't, except for testing. `https` is necessary for secure use of CAS.

## Security Notes

The CAS server does not check that incoming requests to the `/cas/*` routes are secured with https. Since Apostrophe is usually behind a reverse proxy like nginx, this isn't possible anyway. It is your responsibility to ensure that any non-https requests to `/cas/*` URLs are rejected by your proxy server in production.

## Current Limitations

* The CAS client only obtains the username from the CAS server. No other fields are retrieved.
* When using the CAS client, the user must already exist, with the same username, in "Manage People." Support for creating users on the fly with basic permissions as long as they are valid in CAS is a good idea, and we'd accept a pull request for it.
* The CAS server support is very basic only provides the username to the other site. It was built as a convenient way to test the client support.
* There is no CAS proxy support. (Does anybody use that?)
