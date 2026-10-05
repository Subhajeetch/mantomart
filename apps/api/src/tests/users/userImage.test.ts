import { describe, expect, it } from 'vitest';
import {
  isGoogleUserImageUrl,
  resolveAuthSessionImageResponse,
  resolveUserImageResponse,
  resolveUserImageUrl,
} from '@/utils/users/userImage';

const env = {
  API_URL: 'http://localhost:8002',
  R2_PUBLIC_URL: 'https://images.example.com/',
};

describe('user image URL resolution', () => {
  it('recognizes Google-hosted profile image domains without matching lookalikes', () => {
    expect(
      isGoogleUserImageUrl('https://lh3.googleusercontent.com/a/profile')
    ).toBe(true);
    expect(isGoogleUserImageUrl('//lh3.googleusercontent.com/a/profile')).toBe(
      true
    );
    expect(
      isGoogleUserImageUrl('https://googleusercontent.com.evil.example/image')
    ).toBe(false);
  });

  it('leaves Google and other absolute image URLs unchanged', () => {
    const googleImage = 'https://lh3.googleusercontent.com/a/profile?sz=200';
    const externalImage = 'https://cdn.example.org/avatar.png';

    expect(resolveUserImageUrl(googleImage, env, 'http://localhost:8002')).toBe(
      googleImage
    );
    expect(
      resolveUserImageUrl(externalImage, env, 'http://localhost:8002')
    ).toBe(externalImage);
    expect(
      resolveUserImageUrl('//lh3.googleusercontent.com/avatar', env, '')
    ).toBe('//lh3.googleusercontent.com/avatar');
  });

  it('adds the configured R2 host only to canonical relative user-image paths', () => {
    expect(
      resolveUserImageUrl(
        '/user/image/user_123-1760000000000.webp',
        env,
        'http://localhost:8002'
      )
    ).toBe('https://images.example.com/user/image/user_123-1760000000000.webp');
    expect(
      resolveUserImageUrl(
        'user/image/user_123-1760000000000.webp',
        env,
        'http://localhost:8002'
      )
    ).toBe('https://images.example.com/user/image/user_123-1760000000000.webp');
  });

  it('does not prefix malformed, unrelated relative, or already-hosted URLs', () => {
    const hosted = 'https://images.example.com/user/image/user_1-12.webp';

    expect(resolveUserImageUrl('/avatars/default.png', env, '')).toBe(
      '/avatars/default.png'
    );
    expect(resolveUserImageUrl('/user/image/../private.webp', env, '')).toBe(
      '/user/image/../private.webp'
    );
    expect(resolveUserImageUrl(hosted, env, '')).toBe(hosted);
    expect(resolveUserImageUrl(null, env, '')).toBeNull();
  });

  it('uses the API image route when no custom R2 domain is configured', () => {
    expect(
      resolveUserImageUrl(
        '/user/image/user_1-12.webp',
        { API_URL: 'http://localhost:8002' },
        'http://localhost:8002'
      )
    ).toBe('http://localhost:8002/api/images/user/image/user_1-12.webp');
    expect(
      resolveUserImageUrl(
        '/user/image/user_1-12.webp',
        {},
        'http://localhost:8002'
      )
    ).toBe('http://localhost:8002/api/images/user/image/user_1-12.webp');
  });

  it('normalizes user-image objects without changing other fields', () => {
    expect(
      resolveUserImageResponse(
        { id: 'user_1', image: '/user/image/user_1-12.webp' },
        env,
        'http://localhost:8002'
      )
    ).toEqual({
      id: 'user_1',
      image: 'https://images.example.com/user/image/user_1-12.webp',
    });
  });

  it('normalizes relative paths in successful Better Auth session responses', async () => {
    const response = new Response(
      JSON.stringify({
        user: { id: 'user_1', image: '/user/image/user_1-12.webp' },
        session: { id: 'session_1' },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '1',
          'Cache-Control': 'private',
        },
      }
    );

    const normalized = await resolveAuthSessionImageResponse(
      response,
      env,
      'http://localhost:8002'
    );
    const body = (await normalized.json()) as {
      user: { image: string };
      session: { id: string };
    };

    expect(body.user.image).toBe(
      'https://images.example.com/user/image/user_1-12.webp'
    );
    expect(body.session.id).toBe('session_1');
    expect(normalized.headers.get('Content-Length')).toBeNull();
    expect(normalized.headers.get('Cache-Control')).toBe('private');
  });
});
