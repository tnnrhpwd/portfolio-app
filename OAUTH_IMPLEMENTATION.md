# OAuth Social Authentication Integration

This document outlines the implementation of OAuth social authentication for account linking and social login features.

## Overview

The application now includes:
1. **Settings Page**: Account linking section where users can link social accounts (Google, Facebook, Twitter/X, LinkedIn, GitHub)
2. **Login Page**: "Login with" social buttons for alternative authentication methods
3. **Authentication Callback**: Component to handle OAuth responses

## Implementation Details

### Settings Page (`/settings`)

#### New Authentication Section
- **Location**: Added between Privacy Settings and Advanced Settings
- **Features**:
  - List of supported OAuth providers with link/unlink buttons
  - Toggle for enabling social login options
  - Auto-link accounts with same email setting
  - Password verification before account linking (security measure)

#### Supported Providers
- 🌐 Google
- 📘 Facebook  
- 🐦 Twitter/X
- 💼 LinkedIn
- 🐱 GitHub

### Login Page (`/login`)

#### Social Login Buttons
- **Location**: Added between main login form and existing actions
- **Design**: Horizontal layout on larger screens, vertical on mobile
- **Features**:
  - Provider-specific styling and hover effects
  - OAuth popup window integration
  - Loading states and error handling

### Technical Implementation

#### Frontend Components

1. **Settings.jsx**
   - Added `linkedAccounts` state management
   - `handleLinkAccount()` function with password verification
   - OAuth flow initiation with popup windows
   - Account linking status checking

2. **Login.jsx**
   - `handleSocialLogin()` function for OAuth flows
   - Provider-specific configuration and URL building
   - Popup window management

3. **AuthCallback.jsx**
   - Handles OAuth callback responses
   - Parses authorization codes and state parameters
   - Routes to appropriate success/error pages

#### CSS Styling

1. **Settings.css**
   - Responsive account linking section
   - Provider-specific button styling
   - Mobile-optimized touch targets

2. **Login.css**
   - Social login button grid
   - Provider-specific hover effects
   - Responsive design for all screen sizes

## Environment Variables Required

Add these to your `.env` file:

```env
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id
REACT_APP_FACEBOOK_CLIENT_ID=your_facebook_client_id
REACT_APP_TWITTER_CLIENT_ID=your_twitter_client_id
REACT_APP_LINKEDIN_CLIENT_ID=your_linkedin_client_id
REACT_APP_GITHUB_CLIENT_ID=your_github_client_id
```

## Backend Integration Required

### API Endpoints Needed

1. **Password Verification**
   ```
   POST /api/verify-password
   Headers: Authorization: Bearer <token>
   Body: { password: string }
   Response: { valid: boolean }
   ```

2. **OAuth Callback Handler**
   ```
   POST /api/auth/callback
   Body: { 
     provider: string,
     code: string,
     action: 'login' | 'link',
     userId?: string 
   }
   Response: { 
     success: boolean, 
     user?: object,
     message?: string 
   }
   ```

3. **Account Linking Status**
   ```
   GET /api/user/linked-accounts
   Headers: Authorization: Bearer <token>
   Response: { 
     linkedAccounts: {
       google: boolean,
       facebook: boolean,
       twitter: boolean,
       linkedin: boolean,
       github: boolean
     }
   }
   ```

### Database Schema Updates

Add to user model:
```javascript
{
  linkedAccounts: {
    google: { type: Boolean, default: false },
    facebook: { type: Boolean, default: false },
    twitter: { type: Boolean, default: false },
    linkedin: { type: Boolean, default: false },
    github: { type: Boolean, default: false }
  },
  enableSocialLogin: { type: Boolean, default: false },
  autoLinkNewAccounts: { type: Boolean, default: true },
  // OAuth provider data
  oauthProviders: [{
    provider: String, // 'google', 'facebook', etc.
    providerId: String, // User ID from the OAuth provider
    email: String,
    accessToken: String, // Encrypted
    refreshToken: String, // Encrypted
    linkedAt: Date
  }]
}
```

## OAuth Provider Setup

### Google OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select project
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs: `http://localhost:3000/auth/callback/google`

### Facebook OAuth Setup
1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Create app
3. Add Facebook Login product
4. Configure redirect URIs: `http://localhost:3000/auth/callback/facebook`

### GitHub OAuth Setup
1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create new OAuth app
3. Set Authorization callback URL: `http://localhost:3000/auth/callback/github`

### Twitter OAuth Setup
1. Go to [Twitter Developer Portal](https://developer.twitter.com/)
2. Create project and app
3. Enable OAuth 2.0
4. Add callback URL: `http://localhost:3000/auth/callback/twitter`

### LinkedIn OAuth Setup
1. Go to [LinkedIn Developer Portal](https://developer.linkedin.com/)
2. Create app
3. Request access to Sign In with LinkedIn
4. Add redirect URLs: `http://localhost:3000/auth/callback/linkedin`

## Security Considerations

1. **Password Verification**: Users must verify their current password before linking accounts
2. **State Parameter**: OAuth flows include state parameter to prevent CSRF attacks
3. **Token Security**: Store OAuth tokens encrypted in database
4. **Scope Limitation**: Request minimal required scopes from providers
5. **Error Handling**: Graceful handling of OAuth failures and user cancellations

## Current Status

✅ Frontend UI components implemented
✅ OAuth flow initiation
✅ Callback handling structure
🔄 Backend API integration (pending)
🔄 OAuth provider configuration (pending)
🔄 Database schema updates (pending)

## Testing

1. Test account linking flow in settings
2. Test social login buttons on login page  
3. Test OAuth popup windows and callbacks
4. Test responsive design on mobile devices
5. Test error handling for missing configurations

## Future Enhancements

1. Account unlinking functionality
2. Multiple accounts per provider
3. Social profile data synchronization
4. Two-factor authentication integration
5. Admin panel for OAuth provider management
