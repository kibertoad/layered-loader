export const GET_OR_SET_ZERO_WITH_TTL = `
local key = KEYS[1]
local ttl = ARGV[1]

local current_value = redis.call('GET', key)

if current_value == false then
    redis.call('SET', key, 0)
    redis.call('PEXPIRE', key, ttl)
    return 0
end

return current_value
`

export const GET_OR_SET_ZERO_WITHOUT_TTL = `
local key = KEYS[1]

local current_value = redis.call('GET', key)

if current_value == false then
    redis.call('SET', key, 0)
    return 0
end

return current_value
`
