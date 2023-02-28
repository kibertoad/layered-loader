export const SET_GROUP_INDEX_ATOMIC_SCRIPT = `
-- Define the hash key and field name
local key = KEYS[1]
local ttl = ARGV[1]

-- Attempt to retrieve the current value of the field
local current_value = redis.call('GET', key)

-- If the field is not set, set it to 0 and return that value
if current_value == false then
    redis.call('SET', key, 0)
    redis.call('PEXPIRE', key, ttl)
    return 0
end

-- Otherwise, return the current value
return current_value
`
