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

### Creating Users On the Fly

In some cases, any person who can log into the CAS server should also be a valid account on your site.

Here's how to automatically create new people on the fly:

```javascript
    apostrophe-cas: {
      client: {
        protocol: 'https',
        host: 'cas.myschool.edu',
        createPerson: true
      },
    }
```

### Adding New Users to a Group

By default, users created on the fly are not added to any group. You can change that, and also set default permissions for the group if it does not already exist:

```javascript
    apostrophe-cas: {
      client: {
        protocol: 'https',
        host: 'cas.myschool.edu',
        createPerson: {
          group: {
            name: 'guests',
            permissions: [ 'guest' ]
          }
        }
      }
    }
```

### Setting First Names, Last Names and Other Metadata

Since CAS servers frequently don't provide any more information than a username, the default behavior is to set the user's first and last name based on their username, which isn't very satisfying.

As an alternative you can set the `before` option to a callback function that obtains additional information and populates the `person` object more completely, either from the `cas` object in the session or by some other means, such as an LDAP call or database call:

```javascript
    apostrophe-cas: {
      client: {
        protocol: 'https',
        host: 'cas.myschool.edu',
        createPerson: {
          before: function(req, cas, person, callback) {
            // What did the cas server give us? Maybe extra
            // attributes are being passed and we can just
            // set person.firstName and person.lastName etc.

            console.log(cas);

            // No good? Try querying your LDAP or database server
            // with person.username

            // ...All done, invoke the callback
            return callback(null);
          }
        }
      }
      },
    }
```

There is also an `after` option, which takes the same arguments and is invoked after the person exists in the database.

### Subclassing

If you prefer you can subclass the `apostrophe-cas` module and override the `beforeCreatePerson` and `afterCreatePerson` methods in your `index.js` file. You'll need to follow the same pattern used when subclassing `apostrophe-snippets`. If this is all new to you, just use the options.

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

* The CAS client only obtains the username from the CAS server. No other fields are retrieved automatically. However, you can set callbacks to do more with the CAS data.
* The CAS server support is very basic only provides the username to the other site. It was built as a convenient way to test the client support.
* There is no CAS proxy support. (Does anybody use that?)
