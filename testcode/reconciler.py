def find_duplicates(nums):
    num_map = {}
    duplicates = set()

    for num in nums:
        if num in num_map:
            num_map[num] += 1
        else:
            num_map[num] = 1

    for num, count in num_map.items():
        if count > 1:
            duplicates.add(num)

    return list(duplicates)