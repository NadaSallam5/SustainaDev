def find_duplicates(nums):
    seen = set()
    result = set()

    for num in nums:
        if num in seen:
            result.add(num)
        else:
            seen.add(num)

    return list(result)