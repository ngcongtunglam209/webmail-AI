/**
 * Cloudflare Email Worker
 *
 * Deploy lên Cloudflare Workers, bind vào Email Routing.
 * Cần 2 environment variables (Settings → Variables):
 *   INBOUND_URL    = https://yourdomain.com/inbound/cloudflare
 *   INBOUND_SECRET = (cùng giá trị với INBOUND_SECRET trên server)
 */
export default {
  async email(message, env, ctx) {
    if (!env.INBOUND_URL || !env.INBOUND_SECRET) {
      throw new Error('INBOUND_URL and INBOUND_SECRET must be configured');
    }

    // Buffer toàn bộ raw email trước khi gửi
    const rawEmail = await new Response(message.raw).arrayBuffer();

    const response = await fetch(env.INBOUND_URL, {
      method: 'POST',
      headers: {
        'Content-Type':     'message/rfc822',
        'X-Inbound-Secret': env.INBOUND_SECRET,
        'X-Email-To':       message.to,
        'X-Email-From':     message.from,
      },
      body: rawEmail,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Inbound server error ${response.status}: ${body}`);
    }
  },
};
