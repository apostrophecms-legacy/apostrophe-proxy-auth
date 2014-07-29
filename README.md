# apostrophe-proxy-auth

Sometimes you want users to log in via weblogin, cosign, Shibboleth, basic auth or other authentication methods that are not available natively in node. In these situations, you'll want to set up Apache as a reverse proxy, and pass the authenticated user's name to node and Apostrophe. This module allows [Apostrophe](https://apostrophenow.org) to recognize such logins once they arrive.

This documentation also covers how to configure Apache for use with this module in a typical higher education environment with cosign (aka weblogin).

This module does *not* implement weblogin, cosign, basic auth or Shibboleth directly. Instead it relies on Apache to do that, and accepts Apache's word for it when a username is presented via an HTTP header. We'll demonstrate how to ensure that this information is authentic.

## Installation

npm install --save apostrophe-proxy-auth

## Configuration

Add the module to the `modules` section of your `app.js` file:

```javascript
    'apostrophe-proxy-auth': {
    }
```

Next, make sure you shut off the regular authentication system. This is a top-level option in `app.js` (that is, it's not inside "modules," it's at the same level as "modules"):

```javascript
  auth: false
```

Now the usual `/login` form is replaced with code that simply recognizes when a username has been provided by Apache.

## SECURE YOUR SITE CORRECTLY

On your server, as the non-root user with which you deploy Apostrophe, create `/opt/stagecoach/apps/mysite/data/address` and populate it with:

```
127.0.0.1
```

**Otherwise admin user accounts can be spoofed with this module by any moderately talented monkey. You have been warned.**

*What this does:* we'll be trusting the reverse proxy server to provide the authenticated user's name. So we must only accept connections from the reverse proxy, never direct connections. We accomplish this by accepting connections only on the `127.0.0.1` interface (localhost). Here I assume your reverse proxy runs on the same server, which I recommend anyway for performance.

*Never run Apostrophe on shared hosting. Always use a VPS or dedicated server.* But you already knew that.

## Configuring Apache for Cosign

I'll assume you're using Ubuntu Linux. Most of these steps would also apply to other distributions.

**If your node site is already up and running behind some other proxy, like nginx, you need to shut it down and uninstall it: service nginx stop && apt-get remove nginx**

Install Apache (all commands are as root):

```
apt-get install apache2
```

Enable the reverse proxy module and its HTTP protocol module:

```
a2enmod proxy
a2enmod proxy_http
```

Now install the `apache2-dev` Ubuntu package on the server so cosign can compile:

```
apt-get install apache2-dev
```

Now [go get the latest CoSign 3.x source code](http://weblogin.org/download.shtml
).

Untar the file in /usr/local/src.

`cd` into the `cosign-3.x.x` folder, then:

```
./configure --enable-apache2=/usr/bin/apxs2 && make install
```

This will take care of setting up the directives to load the cosign module on the next Apache restart.

## Creating the Cache Folder

The Apache cosign module needs a cache folder. Be sure to create it. Give it to the non-root user and group that Apache is running as, typically `www-data`:

```bash
mkdir -p /var/cache/cosign/filter

chown -R www-data.www-data /var/cache/cosign/filter
```

## Configuration Files

Here I assume your site is secured with SSL. Clients who use cosign and similar systems will almost always require it. You will typically need to obtain a certificate for your site's subdomain through the client.

Create the `/etc/apache2/cosign` folder:

```
mkdir /etc/apache2/cosign
```

**Populate this folder with the certificate and key files provided by your customer.** They may provide separate certificate and key files for use by cosign and for the site itself. Or they may be the same.

**They may also provide a root CA (certificate authority) file** which should be copied to `/etc/ssl/certs`, under a name that does not conflict with other files there. After that, ask the system to rehash the root certificates:

```bash
cp cacert.pem /etc/ssl/certs/cosign-mysite-cacert.pem
c_rehash .
```

First create `/etc/apache2/includes/weblogin.conf` and populate it with these directives needed for all sites using cosign. Here you'll need to replace `myschool.edu` with your customer's domain name, and also change `weblogin.myschool.edu` to your customer's weblogin host if it is different.

```
CosignProtected off
CosignHostname weblogin.myschool.edu
CosignRedirect https://weblogin.myschool.edu/login
CosignPostErrorRedirect https://weblogin.myschool.edu/post_error.html
CosignFilterDB /var/cache/cosign/filter

# Let's allow logins from a test domain we use for our company's projects,
# and also from the client's domain
CosignValidReference https:\/\/.*\.(mytestdomain\.net|myschool\.edu)/.*
CosignValidationErrorRedirect http://weblogin.myschool.edu/validation_error.html

# CoSign 3 requires a validation URL for each protected host.
# This location MUST be available without any restrictions at the registered
# URL (so don't CoSign-protect the entire host).
<Location /cosign/valid>
    SetHandler cosign
    CosignProtected off
    Allow from all
    Satisfy any
</Location>
```

Next, create `/etc/sites-enabled/mysite` and configure it to protect the `/login` URL with cosign and pass the `REMOTE_USER` environment variable on to node via a new HTTP header. Note that this header is always overridden, even if `REMOTE_USER` is empty. This prevents outsiders from "spoofing" accounts, as long as the node process only accepts connections from localhost.

**Review this file carefully, you need to change several settings. This IS rocket science, be patient.** You must ask your customer's cosign administrator for the `CosignService` setting.

**First edit your `/etc/apache2/ports file` and add `Listen 443` if you are not already configured for https on this site.

```apache
# Non-secured site: just redirect to the secured site
<VirtualHost *:80>
        ServerName mysite.myschool.edu
        <LocationMatch />
          RedirectMatch ^/(.*)$ https://mysite.myschool.edu/$1
        </Location>
        ErrorLog /var/log/apache2/mysite.error.log
        CustomLog /var/log/apache2/mysite.access.log vhost_combined
</VirtualHost>

# Secured site: where the action is
<VirtualHost *:443>
  RewriteEngine on
  ServerName mysite.myschool.edu

  SSLEngine On
  # Might or might not be the same file as the cosign certificates, check
  # with your customer's cosign administrator
  SSLCertificateFile /etc/apache2/cosign/mysite-0.crt
  SSLCertificateKeyFile /etc/apache2/cosign/mysite-0.key

  Include /etc/apache2/cosign/weblogin.conf

  # This setting will be provided by your customer's cosign administrator
  CosignService mysite-0

  # Your customer will usually provide a certificate and key for use by
  # cosign which might or might not also be the certificate and key for
  # the site's public SSL; in this example the files are the same.
  # The third argument points to a folder of trusted root certificates,
  # usually /etc/ssl/certs

  CosignCrypto /etc/apache2/cosign/mysite-0.key /etc/apache2/cosign/mysite-0.crt /etc/ssl/certs

  # Reverse proxy, only for URLs that are NOT part of cosign authentication,
  # which must be handled as configured in weblogin.conf and the /login block below
  <LocationMatch "^/(?!cosign)(.*)$">
    # Copy the REMOTE_USER environment variable to a custom HTTP header and pass
    # that on to the node server
    RewriteCond %{REMOTE_USER} (.*)
    RewriteRule .* - [E=X_REMOTE_USER:%1]
    # Pass the URL on to node
    ProxyPassMatch http://localhost:3000/$1
  </LocationMatch>

  # Force login for this URL, set REMOTE_USER once they log in
  <Location /login>
    # Cosign before proxy
    CosignProtected on
    AuthType Cosign
    Require valid-user
    # Check this setting with your customer's cosign administrator
    CosignRequireFactor MYSCHOOL.EDU
  </Location>

  ErrorLog /var/log/apache2/mysite-ssl.error.log
  CustomLog /var/log/apache2/mysite-ssl.access.log vhost_combined
</VirtualHost>
```

Now, assuming you configured Apache correctly and your node app is already listening on port 3000 with this module enabled, you're ready to go:

```bash
service apache2 restart
```

### Creating Users On the Fly

In some cases, any person who can log into the reverse proxy should also be a valid account on your site.

Here's how to automatically create new people on the fly:

```javascript
    'apostrophe-proxy-auth': {
      createPerson: true
    }
```

### Adding New Users to a Group

By default, users created on the fly are not added to any group. You can change that, and also set default permissions for the group if it does not already exist:

```javascript
    'apostrophe-proxy-auth': {
      createPerson: {
        group: {
          name: 'guests',
          permissions: [ 'guest' ]
        }
      }
    }
```

### Forcing an Admin User

You can use the `admin` option to set a username that always receives full admin permissions upon logging in. This is convenient for bootstrapping a new site that uses weblogin, cosign, etc.

First use the `admin` option to give your own account full privileges, then log in and add groups and permissions for other users.

```javascript
    `apostrophe-proxy-auth`: {
      createPerson: true,
      admin: 'jillrocks'
    }
```

### Setting First Names, Last Names and Other Metadata

Since basic auth only provides a username, Apostrophe sets the user's first and last name based on their username. If there is a system of record that can be contacted to learn more about the user, you can pass a `before` callback that phones it up via LDAP or a database call:

```javascript
    'apostrophe-proxy-auth': {
      createPerson: {
        before: function(req, person, callback) {
          // Try querying your LDAP or database server
          // with person.username

          // ...All done, invoke the callback
          return callback(null);
        }
      }
    }
```

There is also an `after` option, which takes the same arguments and is invoked after the person exists in the database. This is handy if you need their `_id` property.

### Subclassing

If you prefer you can subclass the `apostrophe-proxy-auth` module and override the `beforeCreatePerson` and `afterCreatePerson` methods in your `index.js` file. You'll need to follow the same pattern used when subclassing `apostrophe-snippets`. If this is all new to you, just use the options.

The CAS server does not check that incoming requests to the `/cas/*` routes are secured with https. Since Apostrophe is usually behind a reverse proxy like nginx, this isn't possible anyway. It is your responsibility to ensure that any non-https requests to `/cas/*` URLs are rejected by your proxy server in production.

## Logging Out

Logging out works out of the box. If you also want the user logged out of a larger campus "single sign on" environment, provide the `afterLogout` option. The user is redirected to this URL after logout. Ask your customer's cosign administrator what URL to use.

```javascript
    'apostrophe-proxy-auth': {
      // Optional: implement single-sign-out
      afterLogout: 'https://weblogin.myschool.edu/logout'
    }
```

## Disabling the Module for Development

You may wish to disable this module, particularly in a dev environment, so that the regular login mechanism can be used. It's often simplest to do this in `data/local.js`, which is merged with your app configuration from `app.js`. To make this easier, we provide a `disabled` option.

Here's an example `data/local.js` file in which we turn the regular `auth` mechanism back on and disable the `apostrophe-proxy-auth` module:

```javascript
module.exports = {
  auth: true,
  modules: {
    'apostrophe-proxy-auth': {
      disabled: true
    }
  }
}
```

