def find_duplicates(nums):
    num_map = {}
    duplicates = []

    for num in nums:
        if num in num_map:
            num_map[num] += 1
        else:
            num_map[num] = 1

    for num, count in num_map.items():
        if count > 1 and num not in duplicates:
            duplicates.append(num)

    return duplicates