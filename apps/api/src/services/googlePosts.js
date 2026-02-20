// apps/api/src/services/googlePosts.js
import { col } from '../lib/mongo.js'
import { getActiveGoogleIntegration, ensureAccessToken } from '../integrations/google.store.js'

const GOOGLE_BASE = 'https://mybusiness.googleapis.com/v4'

function buildPayload(post) {
  const payload = {
    languageCode: 'en-US',
    summary: String(post.summary || '').trim(),
    topicType: 'STANDARD', // REQUIRED for Local Posts
  }

  // Optional CTA
  if (post.call_to_action_url) {
    payload.callToAction = {
      actionType: 'LEARN_MORE',
      url: String(post.call_to_action_url),
    }
  }

  // Optional media (must be PUBLIC https URL Google can fetch)
  if (post.image_url) {
    payload.media = [{
      mediaFormat: 'PHOTO',
      sourceUrl: String(post.image_url),
    }]
  }

  return payload
}

async function googleJson(accessToken, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text ? { raw: text } : null }

  if (!res.ok) {
    const err = new Error('google_http_error')
    err.status = res.status
    err.statusText = res.statusText
    err.url = url
    err.data = data
    throw err
  }

  return data
}

export async function publishPostNow(postId) {
  const posts = await col('posts')
  const locations = await col('locations')

  const post = await posts.findOne({ id: postId })
  if (!post) throw new Error('post_not_found')

  // already done
  if (post.status === 'published') return { name: post.provider_post_name || null }

  const loc = await locations.findOne({
    id: post.location_id,
    user_id: post.user_id,
    provider: 'google',
  })
  if (!loc) throw new Error('location_not_found')

  const integ = await getActiveGoogleIntegration(post.user_id)
  if (!integ) throw new Error('no_integration')

  const { access_token } = await ensureAccessToken(integ)

  // parent = accounts/{account}/locations/{location}
  const parent = `${loc.provider_account_name}/${loc.provider_location_name}`
  const url = `${GOOGLE_BASE}/${parent}/localPosts`

  await posts.updateOne({ id: postId }, { $set: { status: 'publishing', updated_at: new Date() } })

  const payload = buildPayload(post)
  const created = await googleJson(access_token, 'POST', url, payload)

  await posts.updateOne(
    { id: postId },
    {
      $set: {
        status: 'published',
        provider_post_name: created?.name || null,
        provider_error: null,
        updated_at: new Date(),
      },
    }
  )

  return created
}
